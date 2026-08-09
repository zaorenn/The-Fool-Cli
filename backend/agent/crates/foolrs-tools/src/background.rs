//! Commands that outlive the turn that started them.
//!
//! `ExecCommand` waits for what it starts, with a ceiling of ten minutes. That
//! is right for `git status` and wrong for everything a developer actually
//! leaves running: a dev server, a watcher, a build, a test run somebody wants
//! to keep working alongside. Without this the agent's only options are to
//! block until the ceiling and then report a timeout, or not to start the thing
//! at all.
//!
//! So a background job is started, its output is collected as it arrives, and
//! the agent can look at it later or stop it. Two properties are worth stating
//! because they are the ones that make it safe to leave running.
//!
//! **Output is bounded.** A watcher left running overnight would otherwise fill
//! memory with the same twelve lines repeated a million times; what is kept is
//! the most recent, because that is what anybody asks about.
//!
//! **Everything is killed when the store is dropped.** A conversation that ends
//! must not leave a server holding a port, and an application that quits must
//! not leave children behind.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

/// The most output kept for one job.
///
/// Lines rather than bytes because output is read by a person or a model, and
/// both think in lines. Two thousand is a long scrollback and a small amount of
/// memory.
const MAX_LINES: usize = 2_000;

/// What a background job is doing, and what it has said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobStatus {
    pub id: String,
    pub command: String,
    /// `None` while it is still running.
    pub exit_code: Option<i32>,
    pub running: bool,
    /// How many lines have been dropped from the front to stay bounded.
    pub dropped_lines: usize,
}

struct Job {
    command: String,
    child: Option<Child>,
    lines: Vec<String>,
    dropped: usize,
    /// How much of `lines` the agent has already been shown.
    read_upto: usize,
    exit_code: Option<i32>,
}

/// Jobs started by one conversation.
pub struct BackgroundJobs {
    jobs: Arc<Mutex<HashMap<String, Job>>>,
    next: Arc<Mutex<u64>>,
}

impl Default for BackgroundJobs {
    fn default() -> Self {
        Self::new()
    }
}

impl BackgroundJobs {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            next: Arc::new(Mutex::new(0)),
        }
    }

    /// Starts a command and returns the id it can be asked about by.
    pub fn start(&self, command_line: &str, mut command: Command) -> std::io::Result<String> {
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = command.spawn()?;

        let id = {
            let mut next = self.next.lock().expect("job counter");
            *next += 1;
            format!("job-{next}")
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        self.jobs.lock().expect("jobs").insert(
            id.clone(),
            Job {
                command: command_line.to_string(),
                child: Some(child),
                lines: Vec::new(),
                dropped: 0,
                read_upto: 0,
                exit_code: None,
            },
        );

        // Both streams into one buffer, in the order they arrive: somebody
        // reading a build log wants the error next to the line that caused it,
        // not in a separate pile.
        if let Some(stdout) = stdout {
            self.collect(id.clone(), BufReader::new(stdout).lines());
        }
        if let Some(stderr) = stderr {
            self.collect(id.clone(), BufReader::new(stderr).lines());
        }

        Ok(id)
    }

    fn collect<R>(&self, id: String, mut lines: tokio::io::Lines<BufReader<R>>)
    where
        R: tokio::io::AsyncRead + Unpin + Send + 'static,
    {
        let jobs = self.jobs.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = lines.next_line().await {
                let mut guard = jobs.lock().expect("jobs");
                let Some(job) = guard.get_mut(&id) else { return };
                job.lines.push(line);
                if job.lines.len() > MAX_LINES {
                    job.lines.remove(0);
                    job.dropped += 1;
                    job.read_upto = job.read_upto.saturating_sub(1);
                }
            }
        });
    }

    /// What this job has said since it was last asked.
    ///
    /// Since last time rather than everything, because the agent asks
    /// repeatedly while it waits, and handing back the whole log each time is
    /// how a context window gets filled with the same build output.
    pub fn read_new(&self, id: &str) -> Option<String> {
        let mut guard = self.jobs.lock().expect("jobs");
        let job = guard.get_mut(id)?;
        let fresh = job.lines[job.read_upto.min(job.lines.len())..].join("\n");
        job.read_upto = job.lines.len();
        Some(fresh)
    }

    /// Whether it is still going, and what it exited with.
    pub fn status(&self, id: &str) -> Option<JobStatus> {
        let mut guard = self.jobs.lock().expect("jobs");
        let job = guard.get_mut(id)?;

        if let Some(child) = job.child.as_mut()
            && let Ok(Some(exited)) = child.try_wait()
        {
            job.exit_code = exited.code();
            job.child = None;
        }

        Some(JobStatus {
            id: id.to_string(),
            command: job.command.clone(),
            exit_code: job.exit_code,
            running: job.child.is_some(),
            dropped_lines: job.dropped,
        })
    }

    pub fn ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.jobs.lock().expect("jobs").keys().cloned().collect();
        ids.sort();
        ids
    }

    /// Stops a job. Already finished is success: the state wanted is the state.
    pub fn stop(&self, id: &str) -> bool {
        let mut guard = self.jobs.lock().expect("jobs");
        let Some(job) = guard.get_mut(id) else { return false };
        if let Some(child) = job.child.as_mut() {
            let _ = child.start_kill();
        }
        job.child = None;
        true
    }
}

impl Drop for BackgroundJobs {
    fn drop(&mut self) {
        // A conversation that ends must not leave a server holding a port.
        let mut guard = self.jobs.lock().expect("jobs");
        for job in guard.values_mut() {
            if let Some(child) = job.child.as_mut() {
                let _ = child.start_kill();
            }
        }
    }
}

#[cfg(test)]
#[path = "background_test.rs"]
mod background_test;
