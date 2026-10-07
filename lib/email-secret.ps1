param(
  [ValidateSet('write', 'read', 'delete')][string]$Action,
  [string]$Path
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
switch ($Action) {
  'write' {
    $plain = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Empty secret' }
    $bytes = [Text.Encoding]::UTF8.GetBytes($plain)
    try { $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser) }
    finally { [Array]::Clear($bytes, 0, $bytes.Length) }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
    [IO.File]::WriteAllBytes($Path, $encrypted)
  }
  'read' {
    if (-not [IO.File]::Exists($Path)) { exit 2 }
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($Path), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes)) }
    finally { [Array]::Clear($bytes, 0, $bytes.Length) }
  }
  'delete' {
    if ([IO.File]::Exists($Path)) { [IO.File]::Delete($Path) }
  }
}
