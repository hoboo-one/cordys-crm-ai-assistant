# Windows local development setup. Run from Git Bash or PowerShell.
[CmdletBinding()]
param(
    [string]$DeepSeekKeyFile,
    [switch]$TrustLocalCA,
    [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$root = $PSScriptRoot

function Write-NewText([string]$Path, [string]$Content) {
    $fullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    $stream = [System.IO.File]::Open($fullPath, 'CreateNew', 'Write', 'None')
    try {
        $bytes = $utf8.GetBytes($Content)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally {
        $stream.Dispose()
    }
}

function Require-File([string]$Path) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf) -or !(Get-Item -LiteralPath $Path).Length) {
        throw "Missing or empty file: $Path"
    }
}

function Get-OpenSsl {
    $command = Get-Command openssl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    $git = Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $gitDir = Split-Path -Parent (Split-Path -Parent $git.Source)
    $candidate = Join-Path $gitDir 'usr\bin\openssl.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    throw 'OpenSSL was not found. Use Git for Windows or install OpenSSL and add it to PATH.'
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $Executable $($Arguments[0])" }
}

function Protect-TlsDirectory([string]$Path) {
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    foreach ($identity in @($owner, $system)) {
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Initialize-Tls([string]$Directory) {
    if (Test-Path -LiteralPath $Directory) {
        foreach ($name in 'ca.crt','localhost.crt','localhost.key') {
            Require-File (Join-Path $Directory $name)
        }
        return
    }
    $openssl = Get-OpenSsl
    $parent = Split-Path -Parent $Directory
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $scratch = Join-Path $parent ('tls-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $scratch | Out-Null
    try {
        Protect-TlsDirectory $scratch
        Push-Location -LiteralPath $scratch
        try {
            Write-NewText 'openssl.cnf' @'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = Cordys CRM Local Development CA
[ca_ext]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[server_ext]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost,IP:127.0.0.1
authorityKeyIdentifier = keyid,issuer
'@
            Invoke-Checked $openssl @('genrsa','-out','ca.key','3072')
            Invoke-Checked $openssl @('req','-new','-x509','-sha256','-days','365','-key','ca.key',
                '-config','openssl.cnf','-extensions','ca_ext','-out','ca.crt')
            Invoke-Checked $openssl @('genrsa','-out','localhost.key','2048')
            Invoke-Checked $openssl @('req','-new','-sha256','-key','localhost.key','-subj','/CN=localhost',
                '-config','openssl.cnf','-out','localhost.csr')
            Invoke-Checked $openssl @('x509','-req','-sha256','-days','180','-in','localhost.csr',
                '-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-extfile','openssl.cnf',
                '-extensions','server_ext','-out','localhost.crt')
            Invoke-Checked $openssl @('verify','-CAfile','ca.crt','-verify_hostname','localhost','localhost.crt')
            Invoke-Checked $openssl @('verify','-CAfile','ca.crt','-verify_ip','127.0.0.1','localhost.crt')
            foreach ($name in 'ca.key','ca.srl','localhost.csr','openssl.cnf') { Remove-Item -LiteralPath $name }
        } finally {
            Pop-Location
        }
        [System.IO.Directory]::Move($scratch, $Directory)
    } finally {
        if (Test-Path -LiteralPath $scratch) {
            Get-ChildItem -LiteralPath $scratch -File -Force | Remove-Item -Force
            Remove-Item -LiteralPath $scratch
        }
    }
}

function Initialize-MockConnections {
    $configPath = 'mock-systems\crm-connections.json'
    $hasConfig = Test-Path -LiteralPath $configPath
    $source = if ($hasConfig) { $configPath } else { 'mock-systems\crm-connections.example.json' }
    $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $source | ConvertFrom-Json
    New-Item -ItemType Directory -Path 'mock-systems\tokens' -Force | Out-Null

    foreach ($service in 'orders','warehouse','logistics') {
        $entry = $config.$service
        if ($null -eq $entry -or !$entry.PSObject.Properties['token']) {
            throw "Missing token field for $service in $source"
        }
        $path = "mock-systems\tokens\$service.txt"
        $token = [string]$entry.token
        $hasTokenFile = Test-Path -LiteralPath $path
        if ($hasTokenFile) {
            Require-File $path
            $stored = (Get-Content -Raw -Encoding UTF8 -LiteralPath $path).Trim()
            if (!$stored -or ($token -and $stored -cne $token)) {
                throw "The token file and connection configuration for $service must match."
            }
            $token = $stored
        }
        if ($hasConfig -and !$entry.token) { throw "Fill the $service token in $configPath before retrying." }
        if (!$token) {
            $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try {
                $bytes = New-Object byte[] 32
                $random.GetBytes($bytes)
                $token = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
            } finally {
                $random.Dispose()
            }
        }
        if (!$hasTokenFile) { Write-NewText $path ($token + "`n") }
        $entry.token = $token
    }
    if (!$hasConfig) { Write-NewText $configPath (($config | ConvertTo-Json -Depth 8) + "`n") }
}

function Format-EnvPath([string]$Path) {
    return "'" + $Path.Replace('\','/').Replace("'","\'") + "'"
}

Get-Command docker.exe -CommandType Application -ErrorAction Stop | Out-Null
Push-Location -LiteralPath $root
try {
    if (!(Test-Path -LiteralPath '.env')) {
        if (!$DeepSeekKeyFile) { $DeepSeekKeyFile = Read-Host 'Path to your DeepSeek API key file' }
        Require-File $DeepSeekKeyFile
        $DeepSeekKeyFile = (Resolve-Path -LiteralPath $DeepSeekKeyFile).ProviderPath
        $tls = Join-Path $root '.local\tls'
        Initialize-Tls $tls
        Write-NewText '.env' ((
            "DEEPSEEK_KEY_FILE=$(Format-EnvPath $DeepSeekKeyFile)",
            "TLS_CERT_FILE=$(Format-EnvPath (Join-Path $tls 'localhost.crt'))",
            "TLS_KEY_FILE=$(Format-EnvPath (Join-Path $tls 'localhost.key'))"
        ) -join "`n")
    } elseif ($DeepSeekKeyFile) {
        Write-Host 'Using the existing .env file. Update its key path to change keys.'
    }
    $resolvedJson = docker compose --env-file .env config --format json
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration failed.' }
    $resolved = $resolvedJson | ConvertFrom-Json
    $certificate = $resolved.services.gateway.volumes |
        Where-Object target -eq '/etc/nginx/tls/localhost.crt' | Select-Object -ExpandProperty source
    $privateKey = $resolved.services.gateway.volumes |
        Where-Object target -eq '/etc/nginx/tls/localhost.key' | Select-Object -ExpandProperty source
    Require-File $resolved.secrets.deepseek_key.file
    Require-File $certificate
    Require-File $privateKey
    Initialize-MockConnections
    New-Item -ItemType Directory -Path 'assistant\state' -Force | Out-Null

    if ($TrustLocalCA) {
        $ca = Join-Path (Split-Path -Parent $certificate) 'ca.crt'
        Require-File $ca
        Invoke-Checked (Get-OpenSsl) @('verify','-CAfile',$ca,'-verify_hostname','localhost',$certificate)
        Invoke-Checked 'certutil.exe' @('-user','-addstore','Root',$ca)
    } else {
        Write-Host 'For a generated local CA, use -TrustLocalCA to trust it for your Windows user.'
    }
    if ($PrepareOnly) {
        Write-Host 'Local configuration is ready.'
    } else {
        Invoke-Checked 'docker' @('compose','--env-file','.env','up','-d')
        Invoke-Checked 'docker' @('compose','-f','mock-systems/compose.yaml','-f','mock-systems/compose.crm.yaml','up','-d')
        Write-Host 'CRM containers started. Open https://localhost:8443 after the services initialize.'
    }
} finally {
    Pop-Location
}
