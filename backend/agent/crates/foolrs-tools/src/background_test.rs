use super::*;

fn shell(command_line: &str) -> Command {
    let mut command = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", command_line]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command_line]);
        c
    };
    command.kill_on_drop(true);
    command
}

/// Waits for a job to finish, or gives up. Polling rather than a timer because
/// the point is what the store reports, not how fast the OS is today.
async fn until_finished(jobs: &BackgroundJobs, id: &str) -> JobStatus {
    for _ in 0..200 {
        let status = jobs.status(id).expect("a job");
        if !status.running {
            return status;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    panic!("the job never finished");
}

#[tokio::test]
async fn a_job_runs_and_its_output_can_be_read() {
    let jobs = BackgroundJobs::new();
    let id = jobs
        .start("echo hello_background", shell("echo hello_background"))
        .expect("start");

    until_finished(&jobs, &id).await;
    // Give the collector a moment to drain what the child already wrote.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    assert!(jobs.read_new(&id).expect("output").contains("hello_background"));
}

#[tokio::test]
async fn output_is_only_handed_over_once() {
    // The agent asks repeatedly while it waits. Handing back the whole log each
    // time is how a context window fills with the same build output.
    let jobs = BackgroundJobs::new();
    let id = jobs.start("echo once", shell("echo once")).expect("start");

    until_finished(&jobs, &id).await;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    assert!(jobs.read_new(&id).expect("output").contains("once"));
    assert_eq!(jobs.read_new(&id).expect("output"), "");
}

#[tokio::test]
async fn a_failure_is_reported_with_its_code() {
    let jobs = BackgroundJobs::new();
    let id = jobs.start("exit 3", shell("exit 3")).expect("start");

    let status = until_finished(&jobs, &id).await;
    assert_eq!(status.exit_code, Some(3));
    assert!(!status.running);
}

#[tokio::test]
async fn a_long_job_can_be_stopped() {
    let jobs = BackgroundJobs::new();
    let sleeper = if cfg!(windows) {
        "ping -n 30 127.0.0.1"
    } else {
        "sleep 30"
    };
    let id = jobs.start(sleeper, shell(sleeper)).expect("start");

    assert!(jobs.status(&id).expect("a job").running);
    assert!(jobs.stop(&id));
    assert!(!jobs.status(&id).expect("a job").running);
}

#[tokio::test]
async fn stopping_something_already_finished_is_success() {
    // The state wanted is the state: an agent that treated this as a failure
    // would report one for a job that did exactly what was asked.
    let jobs = BackgroundJobs::new();
    let id = jobs.start("echo done", shell("echo done")).expect("start");
    until_finished(&jobs, &id).await;

    assert!(jobs.stop(&id));
}

#[tokio::test]
async fn asking_about_a_job_that_does_not_exist_is_not_a_panic() {
    let jobs = BackgroundJobs::new();
    assert!(jobs.status("job-404").is_none());
    assert!(jobs.read_new("job-404").is_none());
    assert!(!jobs.stop("job-404"));
}

#[tokio::test]
async fn every_job_is_listed() {
    let jobs = BackgroundJobs::new();
    jobs.start("echo a", shell("echo a")).expect("start");
    jobs.start("echo b", shell("echo b")).expect("start");

    assert_eq!(jobs.ids(), vec!["job-1".to_string(), "job-2".to_string()]);
}
