# The screen, as structured facts rather than as a picture.
#
# Two sources, neither of which touches the GPU. UI Automation is the Windows
# accessibility tree: every button, field and list item an application exposes,
# with the exact rectangle it occupies. OCR is the text the tree cannot describe
# — a canvas, a game, a screenshot inside a document, a PDF page.
#
# Together they answer the question a model actually has, which is not "what does
# this look like" but "what can I press and where is it". A vision model guesses
# coordinates from pixels; this reads them off the control that owns them.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FoolScreen {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, IntPtr extra);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr param);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr param);

  public const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;

  public static string TitleOf(IntPtr hWnd) {
    int length = GetWindowTextLength(hWnd);
    if (length <= 0) return "";
    StringBuilder text = new StringBuilder(length + 1);
    GetWindowText(hWnd, text, text.Capacity);
    return text.ToString();
  }
}
'@

# ---------------------------------------------------------------------------
# Reading the screen
# ---------------------------------------------------------------------------

# Control types worth reporting even when they carry no name of their own: an
# unnamed edit box is still somewhere the user can type, and leaving it out is
# how an agent concludes a form has no fields.
$ActionableTypes = @(
  'Button', 'CheckBox', 'ComboBox', 'Edit', 'Hyperlink', 'ListItem', 'MenuItem',
  'RadioButton', 'Tab', 'TabItem', 'TreeItem', 'Slider', 'Document', 'Custom'
)

function Get-ScreenElements {
  param([System.Windows.Automation.AutomationElement] $Root, [int] $Limit)

  # One cross-process call with a cache rather than a property read per element:
  # a window with a few hundred controls is otherwise seconds of COM round-trips.
  $cache = New-Object System.Windows.Automation.CacheRequest
  foreach ($property in @(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.AutomationElement]::BoundingRectangleProperty,
      [System.Windows.Automation.AutomationElement]::IsEnabledProperty,
      [System.Windows.Automation.AutomationElement]::IsOffscreenProperty,
      [System.Windows.Automation.AutomationElement]::IsKeyboardFocusableProperty,
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty)) {
    $cache.Add($property)
  }
  $cache.Add([System.Windows.Automation.InvokePattern]::Pattern)
  $cache.Add([System.Windows.Automation.ValuePattern]::Pattern)
  $cache.Add([System.Windows.Automation.TogglePattern]::Pattern)

  $token = $cache.Activate()
  try {
    $found = $Root.FindAll(
      [System.Windows.Automation.TreeScope]::Subtree,
      [System.Windows.Automation.Condition]::TrueCondition)
  } finally {
    $token.Dispose()
  }

  $elements = New-Object System.Collections.ArrayList
  foreach ($element in $found) {
    if ($elements.Count -ge $Limit) { break }

    $rect = $element.Cached.BoundingRectangle
    # Nothing with no area and nothing scrolled out of sight: both are real
    # entries in the tree and neither is anywhere the user could click.
    if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }
    if ($element.Cached.IsOffscreen) { continue }

    $type = $element.Cached.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    $name = $element.Cached.Name
    if ([string]::IsNullOrWhiteSpace($name) -and $ActionableTypes -notcontains $type) { continue }

    $value = $null
    $valuePattern = $null
    if ($element.TryGetCachedPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref] $valuePattern)) {
      $value = $valuePattern.Current.Value
    }

    $invokable = $false
    $invokePattern = $null
    if ($element.TryGetCachedPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref] $invokePattern)) {
      $invokable = $true
    }

    [void] $elements.Add([ordered] @{
        role      = $type
        name      = if ($name) { $name.Trim() } else { '' }
        value     = if ($value) { [string] $value } else { $null }
        # The middle of the control: where a click on it should land.
        x         = [int] ($rect.X + $rect.Width / 2)
        y         = [int] ($rect.Y + $rect.Height / 2)
        w         = [int] $rect.Width
        h         = [int] $rect.Height
        enabled   = [bool] $element.Cached.IsEnabled
        typable   = [bool] $element.Cached.IsKeyboardFocusable
        clickable = $invokable
      })
  }
  return $elements
}

function Get-ScreenText {
  param([string] $ImagePath)

  # Windows' own OCR: already installed, runs on the CPU, and picks the language
  # from the user's profile rather than needing one chosen.
  [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
  [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
  [void][System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.WindowsRuntime')

  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

  function Await($operation, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    [void] $task.Wait(-1)
    return $task.Result
  }

  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { return @() }

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

  $lines = New-Object System.Collections.ArrayList
  foreach ($line in $result.Lines) {
    $first = $line.Words | Select-Object -First 1
    if ($null -eq $first) { continue }
    [void] $lines.Add([ordered] @{
        text = $line.Text
        x    = [int] $first.BoundingRect.X
        y    = [int] $first.BoundingRect.Y
      })
  }
  return $lines
}

function Save-Screenshot {
  param([string] $Path)
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
  return @{ path = $Path; width = $bounds.Width; height = $bounds.Height }
}

function Get-OpenWindows {
  $windows = New-Object System.Collections.ArrayList
  $callback = [FoolScreen+EnumProc] {
    param($handle, $param)
    if ([FoolScreen]::IsWindowVisible($handle)) {
      $title = [FoolScreen]::TitleOf($handle)
      if (-not [string]::IsNullOrWhiteSpace($title)) {
        [void] $windows.Add(@{ title = $title; handle = [int64] $handle })
      }
    }
    return $true
  }
  [void][FoolScreen]::EnumWindows($callback, [IntPtr]::Zero)
  return $windows
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

$command = $args[0]

switch ($command) {
  'look' {
    $limit = if ($args[1]) { [int] $args[1] } else { 200 }
    $withText = $args[2] -eq 'text'
    $shotPath = Join-Path $env:TEMP ("fool-screen-" + [guid]::NewGuid().ToString('N') + ".png")

    $handle = [FoolScreen]::GetForegroundWindow()
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $elements = Get-ScreenElements -Root $root -Limit $limit
    $shot = Save-Screenshot -Path $shotPath

    $payload = [ordered] @{
      foreground = [FoolScreen]::TitleOf($handle)
      screenshot = $shot
      # Wrapped so these stay lists in the JSON. `ConvertTo-Json` in Windows
      # PowerShell unwraps a one-item collection into a bare object, so a
      # foreground window exposing exactly one control — a game, a canvas, some
      # full-screen apps — produced `elements: { … }` instead of `elements: [ … ]`
      # and the reader failed with `snapshot.elements.filter is not a function`.
      # Which is to say the agent's eyes closed on precisely the windows it could
      # not otherwise describe.
      windows    = @(Get-OpenWindows)
      elements   = @($elements)
      text       = if ($withText) { @(Get-ScreenText -ImagePath $shotPath) } else { @() }
    }
    $payload | ConvertTo-Json -Depth 6 -Compress
  }

  'read' {
    $shotPath = Join-Path $env:TEMP ("fool-screen-" + [guid]::NewGuid().ToString('N') + ".png")
    [void] (Save-Screenshot -Path $shotPath)
    @{ text = Get-ScreenText -ImagePath $shotPath; screenshot = $shotPath } | ConvertTo-Json -Depth 5 -Compress
  }

  'click' {
    $x = [int] $args[1]
    $y = [int] $args[2]
    $button = if ($args[3]) { $args[3] } else { 'left' }
    [void][FoolScreen]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 40
    if ($button -eq 'right') {
      [FoolScreen]::mouse_event([FoolScreen]::RIGHTDOWN, 0, 0, 0, [IntPtr]::Zero)
      [FoolScreen]::mouse_event([FoolScreen]::RIGHTUP, 0, 0, 0, [IntPtr]::Zero)
    } else {
      [FoolScreen]::mouse_event([FoolScreen]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
      [FoolScreen]::mouse_event([FoolScreen]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
    }
    @{ ok = $true; x = $x; y = $y; button = $button } | ConvertTo-Json -Compress
  }

  'type' {
    # Read from stdin rather than from an argument: what gets typed is arbitrary
    # user text, and putting it on a command line makes its punctuation the
    # shell's business — and a form filled with someone's address should not be
    # able to become a command because it contained a quote.
    $text = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrEmpty($text)) {
      @{ ok = $false; error = 'nothing-to-type' } | ConvertTo-Json -Compress
      exit 1
    }

    # SendKeys reads `+^%~(){}[]` as instructions. Braced, each is the literal
    # character instead — without this, typing an email address into a form
    # sends a keyboard shortcut.
    $escaped = [regex]::Replace($text, '[+^%~(){}\[\]]', { param($m) '{' + $m.Value + '}' })
    # A newline is Enter, which is what it means in a form and in a chat box.
    $escaped = $escaped -replace "`r`n", '{ENTER}' -replace "`n", '{ENTER}'

    # In chunks, with a pause between: SendKeys hands characters to whatever has
    # focus, and a long string posted at once outruns applications that process
    # keys one at a time — the tail of the sentence simply goes missing.
    foreach ($chunk in ($escaped -split '(?<=\G.{80})')) {
      if ($chunk.Length -eq 0) { continue }
      [System.Windows.Forms.SendKeys]::SendWait($chunk)
      Start-Sleep -Milliseconds 25
    }
    @{ ok = $true; characters = $text.Length } | ConvertTo-Json -Compress
  }

  'keys' {
    $keys = $args[1]
    [System.Windows.Forms.SendKeys]::SendWait($keys)
    Start-Sleep -Milliseconds 60
    @{ ok = $true; keys = $keys } | ConvertTo-Json -Compress
  }

  'focus' {
    $wanted = $args[1]
    $match = Get-OpenWindows | Where-Object { $_.title -like "*$wanted*" } | Select-Object -First 1
    if ($null -eq $match) {
      @{ ok = $false; error = 'window-not-found' } | ConvertTo-Json -Compress
      exit 1
    }
    [void][FoolScreen]::SetForegroundWindow([IntPtr] $match.handle)
    Start-Sleep -Milliseconds 150
    @{ ok = $true; title = $match.title } | ConvertTo-Json -Compress
  }

  default {
    @{ ok = $false; error = 'unknown-command' } | ConvertTo-Json -Compress
    exit 1
  }
}
