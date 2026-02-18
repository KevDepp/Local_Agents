# Diagnostic de l'Extension Antigravity Connector
# Ce script aide à identifier pourquoi l'extension ne s'active pas

Write-Host "`n═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "   DIAGNOSTIC EXTENSION ANTIGRAVITY CONNECTOR" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

# 1. Vérifier l'installation
Write-Host "1. Vérification de l'installation..." -ForegroundColor Yellow
$extPath = "$env:USERPROFILE\.antigravity\extensions\local.antigravity-connector-0.0.1"
if (Test-Path $extPath) {
    Write-Host "   ✅ Extension installée dans: $extPath" -ForegroundColor Green
    
    # Vérifier les fichiers essentiels
    $mainFile = Join-Path $extPath "dist\extension.js"
    if (Test-Path $mainFile) {
        Write-Host "   ✅ Fichier principal existe: dist\extension.js" -ForegroundColor Green
    } else {
        Write-Host "   ❌ PROBLÈME: dist\extension.js MANQUANT!" -ForegroundColor Red
        Write-Host "      Solution: Recompiler et repackager l'extension" -ForegroundColor Yellow
    }
    
    $packageJson = Join-Path $extPath "package.json"
    if (Test-Path $packageJson) {
        $pkg = Get-Content $packageJson | ConvertFrom-Json
        Write-Host "   ✅ package.json: $($pkg.name) v$($pkg.version)" -ForegroundColor Green
        Write-Host "      Main: $($pkg.main)" -ForegroundColor Gray
        Write-Host "      ActivationEvents: $($pkg.activationEvents -join ', ')" -ForegroundColor Gray
    }
} else {
    Write-Host "   ❌ PROBLÈME: Extension NON INSTALLÉE!" -ForegroundColor Red
    Write-Host "      Solution: Installer le VSIX depuis Antigravity" -ForegroundColor Yellow
    exit 1
}

# 2. Vérifier que le serveur HTTP tourne
Write-Host "`n2. Vérification du serveur HTTP..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:17375/health" -TimeoutSec 2 -ErrorAction Stop
    Write-Host "   ✅ Serveur HTTP actif sur port 17375" -ForegroundColor Green
    Write-Host "      Response: $($response | ConvertTo-Json -Compress)" -ForegroundColor Gray
    Write-Host "`n   SUCCESS: L'extension fonctionne correctement!" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "   ❌ Serveur HTTP non accessible sur port 17375" -ForegroundColor Red
    Write-Host "      Erreur: $($_.Exception.Message)" -ForegroundColor Gray
}

# 3. Actions recommandées
Write-Host "`n3. Actions recommandées..." -ForegroundColor Yellow
Write-Host ""
Write-Host "   L'extension est installée mais ne démarre pas." -ForegroundColor White
Write-Host "   Causes possibles:" -ForegroundColor White
Write-Host ""
Write-Host "   A) Erreur de compilation JavaScript" -ForegroundColor Cyan
Write-Host "      → Vérifier les logs de la console développeur dans Antigravity" -ForegroundColor Gray
Write-Host "      → Commande: Help > Toggle Developer Tools" -ForegroundColor Gray
Write-Host "      → Chercher des erreurs contenant 'antigravity-connector'" -ForegroundColor Gray
Write-Host ""
Write-Host "   B) Dépendances manquantes (chrome-remote-interface)" -ForegroundColor Cyan
Write-Host "      → Vérifier si node_modules existe dans l'extension" -ForegroundColor Gray
$nodeModules = Join-Path $extPath "node_modules"
if (Test-Path $nodeModules) {
    Write-Host "      ✅ node_modules existe" -ForegroundColor Green
    $cdpModule = Join-Path $nodeModules "chrome-remote-interface"
    if (Test-Path $cdpModule) {
        Write-Host "      ✅ chrome-remote-interface installé" -ForegroundColor Green
    } else {
        Write-Host "      ❌ chrome-remote-interface MANQUANT!" -ForegroundColor Red
        Write-Host "      Solution: Le VSIX doit inclure les dépendances" -ForegroundColor Yellow
    }
} else {
    Write-Host "      ❌ node_modules MANQUANT dans l'extension!" -ForegroundColor Red
    Write-Host "      CAUSE PROBABLE: Le packaging n'a pas inclus les dépendances" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "   C) L'extension n'est pas activée" -ForegroundColor Cyan
Write-Host "      → Dans Antigravity: Ctrl+Shift+X (Extensions)" -ForegroundColor Gray
Write-Host "      → Chercher 'Antigravity Connector'" -ForegroundColor Gray
Write-Host "      → Vérifier qu'elle est activée (pas de bouton 'Enable')" -ForegroundColor Gray
Write-Host ""
Write-Host "   D) Port 17375 déjà utilisé" -ForegroundColor Cyan
Write-Host "      → Vérifier si une autre application utilise ce port" -ForegroundColor Gray
$portInUse = Get-NetTCPConnection -LocalPort 17375 -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "      ⚠️  Port 17375 utilisé par PID: $($portInUse.OwningProcess)" -ForegroundColor Yellow
    $process = Get-Process -Id $portInUse.OwningProcess -ErrorAction SilentlyContinue
    if ($process) {
        Write-Host "      Processus: $($process.ProcessName) ($($process.Id))" -ForegroundColor Gray
    }
} else {
    Write-Host "      ✅ Port 17375 libre" -ForegroundColor Green
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "   PROCHAINES ÉTAPES" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Ouvrir la console développeur dans Antigravity:" -ForegroundColor White
Write-Host "   Help > Toggle Developer Tools" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. Dans la console, taper:" -ForegroundColor White
Write-Host "   vscode.extensions.all.find(e => e.id.includes('antigravity-connector'))" -ForegroundColor Yellow
Write-Host ""
Write-Host "3. Si l'extension apparaît, vérifier son état:" -ForegroundColor White
Write-Host "   - isActive: devrait être true" -ForegroundColor Gray
Write-Host "   - Si false, il y a une erreur d'activation" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Chercher les erreurs dans l'onglet Console:" -ForegroundColor White
Write-Host "   Filtrer par: antigravity-connector" -ForegroundColor Yellow
Write-Host ""
