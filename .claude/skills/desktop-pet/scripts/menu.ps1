# Opens the pet's right-click menu without touching the real mouse, lists its items (with the on/off
# state of checkbox items) and optionally clicks one. Needs a pet started with --remote-debugging-port=9333.
#
#   powershell -NoProfile -File menu.ps1                           # list the items, then close the menu
#   powershell -NoProfile -File menu.ps1 -Click 'Chase the mouse'  # click an item
#
# How: window.pet.contextMenu() over CDP is a right-click. When the voice model is ready the first one
# opens a voice session and a second one skips to the menu; while the model loads, the first one opens
# the menu straight away. The menu is then driven through UI Automation (checkbox items are CheckBox,
# the rest MenuItem).
param([string]$Click = '')

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
$AE = [System.Windows.Automation.AutomationElement]; $TS = [System.Windows.Automation.TreeScope]; $TC = [System.Windows.Automation.Condition]::TrueCondition
$cdp = Join-Path $PSScriptRoot 'cdp-eval.cjs'

function Pet-Pids {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Desktop Pet' -or $_.Path -like '*pet project*node_modules*electron*' } | ForEach-Object { $_.Id })
}
function Menu-Items {
  $p = Pet-Pids
  foreach ($w in $AE::RootElement.FindAll($TS::Children, $TC)) {
    if ($p -notcontains $w.Current.ProcessId) { continue }
    foreach ($e in $w.FindAll($TS::Descendants, $TC)) {
      $t = $e.Current.ControlType.ProgrammaticName
      if ($e.Current.Name -and ($t -eq 'ControlType.MenuItem' -or $t -eq 'ControlType.CheckBox')) { $e }
    }
  }
}

node $cdp 'window.pet.contextMenu(); 1' | Out-Null
Start-Sleep -Milliseconds 1500
if (-not @(Menu-Items)) {
  node $cdp 'window.pet.contextMenu(); 1' | Out-Null
  Start-Sleep -Milliseconds 1200
}
$items = @(Menu-Items)
if (-not $items) { 'menu did not open (is the pet running with --remote-debugging-port=9333?)'; exit 1 }

foreach ($e in $items) {
  $state = ''
  if ($e.Current.ControlType.ProgrammaticName -eq 'ControlType.CheckBox') {
    $state = " [$($e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState)]"
  }
  "  $($e.Current.Name)$state"
}

if ($Click) {
  $item = $items | Where-Object { $_.Current.Name -eq $Click } | Select-Object -First 1
  if (-not $item) { "no item named '$Click'"; [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); exit 1 }
  try { $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
  catch { $item.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle() }
  "clicked '$Click'"
} else {
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
}
