#!/usr/bin/env node

/**
 * Coach Vic Setup Validator
 *
 * Checks if your environment is configured correctly before starting.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ ${message}`, 'blue');
}

async function checkNodeVersion() {
  try {
    const { stdout } = await execAsync('node --version');
    const version = stdout.trim().replace('v', '');
    const majorVersion = parseInt(version.split('.')[0]);

    if (majorVersion >= 20) {
      logSuccess(`Node.js ${version} (>= 20 required)`);
      return true;
    } else {
      logError(`Node.js ${version} (need >= 20)`);
      return false;
    }
  } catch (error) {
    logError('Node.js not found');
    return false;
  }
}

async function checkOpenClawInstalled() {
  try {
    await execAsync('openclaw --version');
    logSuccess('OpenClaw is installed');
    return true;
  } catch (error) {
    logWarning('OpenClaw not installed (run: npm install -g openclaw@latest)');
    return false;
  }
}

function checkBridgeAPIEnv() {
  const envPath = path.join(__dirname, '../bridge-api/.env');

  if (!fs.existsSync(envPath)) {
    logError('.env file not found in bridge-api/');
    logInfo('Run: cp bridge-api/.env.example bridge-api/.env');
    return false;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const requiredVars = [
    'WHOOP_CLIENT_ID',
    'WHOOP_CLIENT_SECRET',
    'PORT',
  ];

  const missingVars = [];
  for (const varName of requiredVars) {
    const regex = new RegExp(`^${varName}=.+$`, 'm');
    if (!regex.test(envContent) || envContent.includes(`${varName}=your_`)) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length === 0) {
    logSuccess('Bridge API .env configured');
    return true;
  } else {
    logError(`Missing or incomplete in .env: ${missingVars.join(', ')}`);
    return false;
  }
}

function checkBridgeAPIDependencies() {
  const nodeModulesPath = path.join(__dirname, '../bridge-api/node_modules');

  if (fs.existsSync(nodeModulesPath)) {
    logSuccess('Bridge API dependencies installed');
    return true;
  } else {
    logWarning('Bridge API dependencies not installed');
    logInfo('Run: cd bridge-api && npm install');
    return false;
  }
}

function checkTokensFile() {
  const tokensPath = path.join(__dirname, '../bridge-api/tokens.json');

  if (fs.existsSync(tokensPath)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
      const services = Object.keys(tokens);

      if (services.length > 0) {
        logSuccess(`OAuth tokens found for: ${services.join(', ')}`);
        return true;
      } else {
        logWarning('tokens.json exists but is empty');
        logInfo('Run OAuth flows: npm run auth:all');
        return false;
      }
    } catch (error) {
      logError('tokens.json is invalid JSON');
      return false;
    }
  } else {
    logWarning('No OAuth tokens found');
    logInfo('Run OAuth flows after starting Bridge API');
    return false;
  }
}

async function checkBridgeAPIRunning() {
  try {
    const { stdout } = await execAsync('curl -s http://127.0.0.1:3000/health');
    const response = JSON.parse(stdout);

    if (response.ok) {
      logSuccess('Bridge API is running');
      return true;
    }
  } catch (error) {
    logWarning('Bridge API not running');
    logInfo('Start it: cd bridge-api && npm run dev');
    return false;
  }
}

async function main() {
  log('\n' + '='.repeat(50), 'bold');
  log('Coach Vic Setup Validator', 'bold');
  log('='.repeat(50) + '\n', 'bold');

  log('Checking prerequisites...', 'blue');
  const nodeOk = await checkNodeVersion();
  const openclawOk = await checkOpenClawInstalled();

  log('\nChecking Bridge API...', 'blue');
  const envOk = checkBridgeAPIEnv();
  const depsOk = checkBridgeAPIDependencies();
  const tokensOk = checkTokensFile();
  const bridgeRunning = await checkBridgeAPIRunning();

  log('\n' + '='.repeat(50), 'bold');

  const allChecks = [nodeOk, openclawOk, envOk, depsOk];
  const criticalPassed = allChecks.every(check => check);

  if (criticalPassed) {
    logSuccess('All critical checks passed!');

    if (!tokensOk) {
      log('\nNext steps:', 'yellow');
      log('1. Start Bridge API: cd bridge-api && npm run dev');
      log('2. Run OAuth flows: visit http://127.0.0.1:3000/auth/whoop/start');
      log('3. Configure OpenClaw: openclaw onboard');
    } else if (!bridgeRunning) {
      log('\nNext steps:', 'yellow');
      log('1. Start Bridge API: cd bridge-api && npm run dev');
      log('2. Start OpenClaw: openclaw gateway --port 18789');
    } else {
      logSuccess('\nYou\'re all set! Coach Vic is ready to go.');
    }
  } else {
    logError('\nSome checks failed. Fix the issues above and run this script again.');
    process.exit(1);
  }

  log('\n' + '='.repeat(50) + '\n', 'bold');
}

main().catch(error => {
  logError(`\nError: ${error.message}`);
  process.exit(1);
});
