#!/usr/bin/env pwsh
# Development Startup Script for AfraPay with Appwrite Integration

Write-Host "🚀 Starting AfraPay Development Environment" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

# Check if Docker is running
Write-Host "📋 Checking Docker..." -ForegroundColor Yellow
try {
    docker ps | Out-Null
    Write-Host "✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not running. Please start Docker first." -ForegroundColor Red
    exit 1
}

# Check if PostgreSQL is running
Write-Host "📋 Checking PostgreSQL..." -ForegroundColor Yellow
try {
    $pgTest = Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue
    if ($pgTest.TcpTestSucceeded) {
        Write-Host "✅ PostgreSQL is running on localhost:5432" -ForegroundColor Green
    } else {
        throw "PostgreSQL is not reachable"
    }
} catch {
    Write-Host "⚠️  PostgreSQL is not running. Starting PostgreSQL container..." -ForegroundColor Yellow
    try {
        docker run --name afrapay-postgres -e POSTGRES_USER=bxlaalph_afrapay_app -e POSTGRES_PASSWORD=94KSBFn:7(att0 -e POSTGRES_DB=bxlaalph_afrapay -p 5432:5432 -d postgres:16
        Start-Sleep -Seconds 3
        $pgTest = Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue
        if ($pgTest.TcpTestSucceeded) {
            Write-Host "✅ PostgreSQL container started successfully" -ForegroundColor Green
        } else {
            Write-Host "❌ PostgreSQL container could not be started. Check Docker and port 5432." -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "❌ Failed to start PostgreSQL with Docker. Ensure Docker is running and PostgreSQL is reachable." -ForegroundColor Red
        exit 1
    }
}

# Check if Appwrite is running
Write-Host "📋 Checking Appwrite..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:8080/health" -TimeoutSec 5
    Write-Host "✅ Appwrite is running" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Appwrite is not running. Starting Appwrite..." -ForegroundColor Yellow
    
    # Create appwrite directory if it doesn't exist
    if (-not (Test-Path "appwrite")) {
        New-Item -ItemType Directory -Name "appwrite"
    }
    
    Set-Location "appwrite"
    
    # Download docker-compose if it doesn't exist
    if (-not (Test-Path "docker-compose.yml")) {
        Write-Host "📥 Downloading Appwrite docker-compose.yml..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri "https://appwrite.io/install/compose" -OutFile "docker-compose.yml"
    }
    
    # Start Appwrite
    Write-Host "🔄 Starting Appwrite containers..." -ForegroundColor Yellow
    docker-compose up -d
    
    # Wait for Appwrite to be ready
    Write-Host "⏳ Waiting for Appwrite to start..." -ForegroundColor Yellow
    $attempts = 0
    do {
        Start-Sleep -Seconds 5
        $attempts++
        try {
            $response = Invoke-RestMethod -Uri "http://localhost:8080/health" -TimeoutSec 5
            $appwriteReady = $true
            Write-Host "✅ Appwrite is ready!" -ForegroundColor Green
        } catch {
            Write-Host "⏳ Still waiting for Appwrite... (attempt $attempts/12)" -ForegroundColor Yellow
            $appwriteReady = $false
        }
    } while (-not $appwriteReady -and $attempts -lt 12)
    
    if (-not $appwriteReady) {
        Write-Host "❌ Appwrite failed to start after 60 seconds" -ForegroundColor Red
        exit 1
    }
    
    Set-Location ".."
}

# Check environment files
Write-Host "📋 Checking environment files..." -ForegroundColor Yellow

if (-not (Test-Path "backend\.env")) {
    if (Test-Path "backend\.env.example") {
        Copy-Item "backend\.env.example" "backend\.env"
        Write-Host "⚠️  Created backend/.env from .env.example. Please configure it!" -ForegroundColor Yellow
    } else {
        Write-Host "❌ backend/.env.example not found" -ForegroundColor Red
    }
}

if (-not (Test-Path "frontend\.env")) {
    if (Test-Path "frontend\.env.example") {
        Copy-Item "frontend\.env.example" "frontend\.env"
        Write-Host "⚠️  Created frontend/.env from .env.example. Please configure it!" -ForegroundColor Yellow
    } else {
        Write-Host "❌ frontend/.env.example not found" -ForegroundColor Red
    }
}

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow

# Backend dependencies
Set-Location "backend"
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Installing backend dependencies..." -ForegroundColor Yellow
    npm install
}
Set-Location ".."

# Frontend dependencies
Set-Location "frontend"
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Installing frontend dependencies..." -ForegroundColor Yellow
    npm install
}
Set-Location ".."

# Start services
Write-Host "🚀 Starting development servers..." -ForegroundColor Green

# Start backend in background
Write-Host "🔧 Starting backend server on http://localhost:5000..." -ForegroundColor Yellow
Start-Process -FilePath "pwsh" -ArgumentList "-Command", "cd backend; npm run dev" -WindowStyle Normal

# Wait a bit for backend to start
Start-Sleep -Seconds 3

# Start frontend
Write-Host "⚛️  Starting frontend server on http://localhost:3000..." -ForegroundColor Yellow
Set-Location "frontend"
npm start

Write-Host "" -ForegroundColor White
Write-Host "🎉 AfraPay Development Environment Started!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host "" -ForegroundColor White
Write-Host "📱 Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "🔧 Backend: http://localhost:5000" -ForegroundColor Cyan
Write-Host "🗄️  Appwrite: http://localhost:8080" -ForegroundColor Cyan
Write-Host "" -ForegroundColor White
Write-Host "📚 Setup Guide: See APPWRITE_SETUP.md" -ForegroundColor Yellow
Write-Host "🔧 Configure environment files before first use!" -ForegroundColor Yellow