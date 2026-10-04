# Turns the built app folder into one variant: the exe takes the app name, custom.txt sits next to it.
param(
    [Parameter(Mandatory)] [string] $Src,
    [Parameter(Mandatory)] [string] $CustomTxt,
    [Parameter(Mandatory)] [string] $AppName,
    [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = 'Stop'
if (Test-Path $Out) { throw "refusing to overwrite $Out" }
Copy-Item -Recurse $Src $Out
Move-Item (Join-Path $Out 'rustdesk.exe') (Join-Path $Out "$AppName.exe")
Copy-Item $CustomTxt (Join-Path $Out 'custom.txt')
