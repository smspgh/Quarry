<#
  Benchmark for native editors without a debugging port (Notepad++, UltraEdit). See bench/README.md.

    powershell -File bench\native.ps1 -Exe <editor.exe> -File <file> [-Timeout 180] [-Settle 5]

  Launches the editor with the file and reports:
    title   - when a window of the editor first shows the file's name in its title
    loaded  - when, after that, the editor (all its processes) has stopped reading from disk for
              1 s: it has read what it needs of the file. (CPU is not used: some editors keep busy
              in the background for many seconds after start-up whatever the file.) Reads through a
              memory mapping are not counted by Windows, so for an editor that maps the file this is
              close to the title time.
    memory  - total private memory of the editor's processes when loaded and after -Settle seconds
  A prompt (dialog box) the editor shows is recorded with its text and answered with its default
  button, so a person's click isn't part of the time. The editor is closed afterwards.
#>
param(
  [Parameter(Mandatory)] [string]$Exe,
  [Parameter(Mandatory)] [string]$File,
  [int]$Timeout = 180,
  [int]$Settle = 5
)

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class QWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
  [DllImport("kernel32.dll")] static extern bool GetProcessIoCounters(IntPtr h, out IoCounters c);
  // Bytes read (ReadFile and the like) by the given processes so far.
  public static ulong ReadBytes(int[] pids) {
    ulong sum = 0;
    foreach (var id in pids) {
      try { using (var p = System.Diagnostics.Process.GetProcessById(id)) { IoCounters c; if (GetProcessIoCounters(p.Handle, out c)) sum += c.ReadBytes; } } catch { }
    }
    return sum;
  }
  static string Text(IntPtr h) { var s = new StringBuilder(1024); GetWindowText(h, s, 1024); return s.ToString(); }
  static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  // Visible top-level windows of the given processes: "class|title" (dialogs also list their texts).
  public static List<string> Windows(int[] pids) {
    var set = new HashSet<int>(pids); var r = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (set.Contains((int)pid) && IsWindowVisible(h)) {
        string c = Cls(h), t = Text(h);
        if (c == "#32770") {
          var parts = new List<string>();
          EnumChildWindows(h, (k, m) => { var x = Text(k); if (x.Length > 0) parts.Add(x); return true; }, IntPtr.Zero);
          t = t + " :: " + string.Join(" / ", parts);
        }
        r.Add(c + "|" + h.ToInt64() + "|" + t);
      }
      return true;
    }, IntPtr.Zero);
    return r;
  }
  // Press a dialog's default button (DM_GETDEFID, then WM_COMMAND with that id).
  public static void PressDefault(long hwnd) {
    var h = new IntPtr(hwnd);
    long r = SendMessage(h, 0x0400, IntPtr.Zero, IntPtr.Zero).ToInt64();
    int id = (r >> 16) == 0x534B ? (int)(r & 0xFFFF) : 1;
    SendMessage(h, 0x0111, new IntPtr(id), IntPtr.Zero);
  }
}
"@

function Tree([int]$root) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, PrivatePageCount
  $ids = @($root); $added = $true
  while ($added) { $added = $false; foreach ($p in $all) { if ($ids -contains [int]$p.ParentProcessId -and -not ($ids -contains [int]$p.ProcessId)) { $ids += [int]$p.ProcessId; $added = $true } } }
  $mb = [math]::Round((($all | Where-Object { $ids -contains [int]$_.ProcessId } | Measure-Object PrivatePageCount -Sum).Sum) / 1MB)
  return @{ Ids = $ids; MB = $mb }
}

$name = Split-Path $File -Leaf
$sw = [Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $Exe -ArgumentList "`"$File`"" -PassThru
$titleAt = $null; $loadedAt = $null; $prompts = @(); $answered = @{}
# While timing, watch only the editor's own process: listing every process (for the memory total)
# takes over a second, which would hide anything that happens sooner.
$main = @($proc.Id)
$lastRead = [QWin]::ReadBytes($main); $lastReadAt = $sw.ElapsedMilliseconds; $quiet = 0

while ($sw.Elapsed.TotalSeconds -lt $Timeout) {
  foreach ($w in [QWin]::Windows($main)) {
    $cls, $hwnd, $title = $w -split '\|', 3
    if ($cls -eq '#32770' -and -not $answered.ContainsKey($hwnd)) {
      $answered[$hwnd] = $true
      $prompts += ("{0:N1} s: {1}" -f $sw.Elapsed.TotalSeconds, ($title -replace '\s+', ' '))
      Start-Sleep -Milliseconds 300
      [QWin]::PressDefault([long]$hwnd)
    } elseif (-not $titleAt -and $title -like "*$name*") {
      $titleAt = $sw.Elapsed.TotalSeconds
    }
  }
  # After the title shows, wait until disk reads stop for 1 s (two 500 ms samples under 1 MB).
  if ($sw.ElapsedMilliseconds - $lastReadAt -ge 500) {
    $read = [QWin]::ReadBytes($main)
    if ($titleAt -and ($read - $lastRead) -lt 1MB) { $quiet++ } else { $quiet = 0 }
    if ($quiet -ge 2 -and -not $loadedAt) { $loadedAt = [math]::Max($titleAt, $sw.Elapsed.TotalSeconds - 1.0); break }
    $lastRead = $read; $lastReadAt = $sw.ElapsedMilliseconds
  }
  Start-Sleep -Milliseconds 20
}

$readMB = [math]::Round([QWin]::ReadBytes($main) / 1MB)
$memLoaded = (Tree $proc.Id).MB
Start-Sleep -Seconds $Settle
$memSettled = (Tree $proc.Id).MB
$app = [IO.Path]::GetFileNameWithoutExtension($Exe)
foreach ($i in (Tree $proc.Id).Ids) { Stop-Process -Id $i -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 1500

$t = if ($titleAt) { "title {0:N2} s" -f $titleAt } else { "title never showed the file" }
$l = if ($loadedAt) { "loaded {0:N2} s (read {1} MB from disk)" -f $loadedAt, $readMB } else { "still reading after $Timeout s" }
$p = if ($prompts.Count) { " | prompts (answered with the default button): " + ($prompts -join " ; ") } else { "" }
"{0,-9} {1,-15} {2} | {3} | memory {4} MB when loaded, {5} MB after {6} s{7}" -f $app, $name, $t, $l, $memLoaded, $memSettled, $Settle, $p
