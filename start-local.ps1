Set-Location -LiteralPath $PSScriptRoot
Write-Host "Starting brotel.ms on http://127.0.0.1:4173"
Write-Host ""
Write-Host "Login:"
Write-Host "  Username: admin"
Write-Host "  Password: admin123"
Write-Host ""
node server.js
