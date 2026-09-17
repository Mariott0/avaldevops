$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$deliveryRoot = Join-Path $projectRoot 'entrega'
$archivePath = Join-Path $deliveryRoot 'trabalho-devops.zip'
New-Item -ItemType Directory -Force -Path $deliveryRoot | Out-Null

# Lista permitida: nunca inclui .env, node_modules, Git ou artefatos temporarios.
$rootFiles = @('docker-compose.yml', '.env.example', '.gitignore', '.gitattributes', 'README.md', 'nomes.txt')
$sourceFolders = @('backend', 'frontend', 'scripts', 'docs')
$sourceFiles = @()
foreach ($file in $rootFiles) {
    $filePath = Join-Path $projectRoot $file
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        throw "Arquivo obrigatorio ausente: $file"
    }
    $sourceFiles += Get-Item -LiteralPath $filePath -Force
}
foreach ($folder in $sourceFolders) {
    $folderPath = Join-Path $projectRoot $folder
    $sourceFiles += Get-ChildItem -LiteralPath $folderPath -Recurse -File -Force |
        Where-Object {
            $_.FullName -notmatch '[\\/](node_modules|coverage|\.artifacts|\.git)[\\/]' -and
            $_.Name -notmatch '^(\.env($|\.)|.*\.(log|tmp|zip)$)'
        }
}

# Substitui somente o ZIP de entrega conhecido, sem remover pastas ou dados.
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
$archive = [System.IO.Compression.ZipFile]::Open($archivePath, 'Create')
try {
    foreach ($file in $sourceFiles | Sort-Object FullName) {
        $relativePath = $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $file.FullName, "trabalho-devops/$relativePath",
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $archive.Dispose()
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'nomes.txt') -Destination (Join-Path $deliveryRoot 'nomes.txt') -Force
Write-Output "ZIP criado: $archivePath"
Write-Output "Nomes: $(Join-Path $deliveryRoot 'nomes.txt')"
