console.clear();
console.log(`
                  KALEIDO TESTNET BOT                        
`);

import { ethers } from "ethers";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import readline from "readline";

// Configuration
const KALEIDO_RPC_URL = "https://11124.rpc.thirdweb.com/1f9e649fdf16709afd04bb52b54d1964";
const KALEIDO_CHAIN_ID = 11124;
const KLD_TOKEN_ADDRESS = "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505";
const USDC_TOKEN_ADDRESS = "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3";
const DEPOSIT_ROUTER_ADDRESS = "0x2aC60481a9EA2e67D80CdfBF587c63c88A5874ac";
const STAKE_ROUTER_ADDRESS = "0xb6fb7fd04eCF2723f8a5659134a145Bd7fE68748";
const FAUCET_ROUTER_ADDRESS = "0xC99eddf1f7C9250728A47978732928aE158396E7";

// ABIs
const tokenAbi = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)"
];

const faucetAbi = [
  "function lastClaimed(address) view returns (uint256)",
  "function COOLDOWN() view returns (uint256)",
  "function hasClaimedBefore(address) view returns (bool)"
];

// Global variables
let privateKeys = [];
let proxies = [];
let isRunning = false;
let shouldStop = false;

// Create readline interface for CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// Load private keys
function loadPrivateKeys() {
  try {
    const data = fs.readFileSync("pk.txt", "utf8");
    privateKeys = data.split("\n")
      .map(key => key.trim())
      .filter(key => key.match(/^(0x)?[0-9a-fA-F]{64}$/));
    
    if (privateKeys.length === 0) {
      throw new Error("No valid private keys in pk.txt");
    }
    console.log(`📋 Loaded ${privateKeys.length} private keys from pk.txt`);
  } catch (error) {
    console.error(`❌ Failed to load private keys: ${error.message}`);
    privateKeys = [];
  }
}

// Load proxies
function loadProxies() {
  try {
    if (fs.existsSync("proxy.txt")) {
      const data = fs.readFileSync("proxy.txt", "utf8");
      proxies = data.split("\n")
        .map(proxy => proxy.trim())
        .filter(proxy => proxy);
      
      if (proxies.length === 0) {
        console.log(`⚠️ No proxy found in proxy.txt`);
      } else {
        console.log(`📋 Loaded ${proxies.length} proxies from proxy.txt`);
      }
    } else {
      console.log(`⚠️ proxy.txt not found, running without proxy`);
    }
  } catch (error) {
    console.error(`❌ Error loading proxies: ${error.message}`);
  }
}

function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;
  
  try {
    if (proxyUrl.startsWith("socks")) {
      return new SocksProxyAgent(proxyUrl);
    } else {
      return new HttpsProxyAgent(proxyUrl);
    }
  } catch (error) {
    console.error(`❌ Error creating proxy agent: ${error.message}`);
    return null;
  }
}

function createProvider(proxy = null) {
  const options = {
    throttleLimit: 1,
    throttleSlotInterval: 100
  };
  
  if (proxy) {
    try {
      const agent = createProxyAgent(proxy);
      if (agent) {
        options.fetchOptions = {
          agent: agent
        };
      }
    } catch (err) {
      console.error(`❌ Error setting up proxy: ${err.message}`);
      console.log(`⚠️ Continuing without proxy...`);
    }
  }
  
  return new ethers.JsonRpcProvider(KALEIDO_RPC_URL, { chainId: KALEIDO_CHAIN_ID, name: "Kaleido" }, options);
}

// Retry function for RPC calls
async function retryWithDelay(fn, maxRetries = 3, delay = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`⚠️ Error occurred, retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

async function safeRpcCall(fn, description = "RPC call") {
  if (shouldStop) throw new Error("Process stopped by user");
  await new Promise(resolve => setTimeout(resolve, 200));
  return await retryWithDelay(fn, 3, 1000);
}

function getRandomAmount(min, max) {
  return (Math.random() * (max - min) + min).toFixed(4);
}

function getRandomDelay(min = 10, max = 30) {
  const seconds = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => {
    let remaining = seconds;
    const interval = setInterval(() => {
      if (shouldStop) {
        clearInterval(interval);
        resolve();
        return;
      }
      process.stdout.write(`\r⏱️ Delay: ${remaining} detik...`);
      remaining--;
      if (remaining < 0) {
        clearInterval(interval);
        console.log("");
        resolve();
      }
    }, 1000);
  });
}

// Display balances
async function displayBalances(wallet, title) {
  console.log(`\n💰 ${title}:`);
  try {
    // ETH Balance
    const ethBalance = await safeRpcCall(() => wallet.provider.getBalance(wallet.address), "get ETH balance");
    console.log(`→ ETH: ${parseFloat(ethers.formatUnits(ethBalance, 18)).toFixed(4)}`);
    
    // USDC Balance
    const usdcContract = new ethers.Contract(USDC_TOKEN_ADDRESS, tokenAbi, wallet);
    const usdcBalance = await safeRpcCall(() => usdcContract.balanceOf(wallet.address), "get USDC balance");
    console.log(`→ USDC: ${parseFloat(ethers.formatUnits(usdcBalance, 6)).toFixed(2)}`);
    
    // KLD Balance
    const kldContract = new ethers.Contract(KLD_TOKEN_ADDRESS, tokenAbi, wallet);
    const kldBalance = await safeRpcCall(() => kldContract.balanceOf(wallet.address), "get KLD balance");
    console.log(`→ KLD: ${parseFloat(ethers.formatUnits(kldBalance, 18)).toFixed(4)}`);
  } catch (error) {
    console.log(`→ Error getting balances: ${error.message}`);
  }
}

// Claim Faucet
async function claimFaucet(wallet) {
  try {
    console.log(`\n🚰 Claiming Faucet for ${wallet.address.slice(0, 8)}...`);
    
    const faucetContract = new ethers.Contract(FAUCET_ROUTER_ADDRESS, faucetAbi, wallet);
    
    // Check USDC faucet eligibility
    const lastClaimedUSDC = await safeRpcCall(() => faucetContract.lastClaimed(wallet.address), "check USDC last claimed");
    const cooldown = await safeRpcCall(() => faucetContract.COOLDOWN(), "get cooldown");
    const currentTime = Math.floor(Date.now() / 1000);
    
    const usdcEligible = Number(lastClaimedUSDC) === 0 || (currentTime - Number(lastClaimedUSDC)) >= Number(cooldown);
    
    if (usdcEligible) {
      console.log(`📤 Claiming USDC Faucet...`);
      const usdcTx = await safeRpcCall(() => wallet.sendTransaction({
        to: FAUCET_ROUTER_ADDRESS,
        data: "0x4451d89f",
        gasLimit: 2100000
      }), "claim USDC faucet");
      
      await safeRpcCall(() => usdcTx.wait(), "wait for USDC faucet tx");
      console.log(`✅ USDC Faucet claimed! Tx: ${usdcTx.hash.slice(0, 10)}...`);
    } else {
      const timeLeft = Number(cooldown) - (currentTime - Number(lastClaimedUSDC));
      console.log(`⚠️ USDC Faucet not eligible. Wait ${Math.floor(timeLeft/3600)}h ${Math.floor((timeLeft%3600)/60)}m`);
    }
    
    // Small delay between claims
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check KLD faucet eligibility  
    console.log(`📤 Claiming KLD Faucet...`);
    try {
      const kldTx = await safeRpcCall(() => wallet.sendTransaction({
        to: FAUCET_ROUTER_ADDRESS,
        data: "0x45d3b1f7",
        gasLimit: 2100000
      }), "claim KLD faucet");
      
      await safeRpcCall(() => kldTx.wait(), "wait for KLD faucet tx");
      console.log(`✅ KLD Faucet claimed! Tx: ${kldTx.hash.slice(0, 10)}...`);
    } catch (error) {
      if (error.message.includes("revert")) {
        console.log(`⚠️ KLD Faucet not eligible or already claimed`);
      } else {
        console.log(`❌ KLD Faucet claim failed: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error(`❌ Faucet claim failed: ${error.message}`);
  }
}

// Deposit Collateral
async function depositCollateral(wallet, amount) {
  try {
    console.log(`\n💰 Depositing ${amount} USDC as Collateral...`);
    
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    const usdcContract = new ethers.Contract(USDC_TOKEN_ADDRESS, tokenAbi, wallet);
    
    // Check balance
    const balance = await safeRpcCall(() => usdcContract.balanceOf(wallet.address), "check USDC balance");
    if (balance < amountWei) {
      throw new Error(`Insufficient USDC balance: ${ethers.formatUnits(balance, 6)} USDC available`);
    }
    
    // Check allowance
    const allowance = await safeRpcCall(() => usdcContract.allowance(wallet.address, DEPOSIT_ROUTER_ADDRESS), "check allowance");
    if (allowance < amountWei) {
      console.log(`📝 Approving ${amount} USDC...`);
      const approveTx = await safeRpcCall(() => usdcContract.approve(DEPOSIT_ROUTER_ADDRESS, amountWei), "approve USDC");
      await safeRpcCall(() => approveTx.wait(), "wait for approve tx");
      console.log(`✅ Approval successful! Tx: ${approveTx.hash.slice(0, 10)}...`);
    }
    
    // Deposit
    const data = "0xa5d5db0c" +
      ethers.zeroPadValue(USDC_TOKEN_ADDRESS, 32).slice(2) +
      ethers.zeroPadValue(ethers.toBeHex(amountWei), 32).slice(2);
    
    const tx = await safeRpcCall(() => wallet.sendTransaction({
      to: DEPOSIT_ROUTER_ADDRESS,
      data,
      gasLimit: 691650
    }), "execute deposit");
    
    await safeRpcCall(() => tx.wait(), "wait for deposit tx");
    console.log(`✅ Deposit successful! Tx: ${tx.hash.slice(0, 10)}...`);
    
  } catch (error) {
    console.error(`❌ Deposit failed: ${error.message}`);
  }
}

// Lend
async function lend(wallet, amount) {
  try {
    console.log(`\n🏦 Lending ${amount} USDC...`);
    
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    const usdcContract = new ethers.Contract(USDC_TOKEN_ADDRESS, tokenAbi, wallet);
    
    // Check balance
    const balance = await safeRpcCall(() => usdcContract.balanceOf(wallet.address), "check USDC balance");
    if (balance < amountWei) {
      throw new Error(`Insufficient USDC balance: ${ethers.formatUnits(balance, 6)} USDC available`);
    }
    
    // Check allowance
    const allowance = await safeRpcCall(() => usdcContract.allowance(wallet.address, DEPOSIT_ROUTER_ADDRESS), "check allowance");
    if (allowance < amountWei) {
      console.log(`📝 Approving ${amount} USDC...`);
      const approveTx = await safeRpcCall(() => usdcContract.approve(DEPOSIT_ROUTER_ADDRESS, amountWei), "approve USDC");
      await safeRpcCall(() => approveTx.wait(), "wait for approve tx");
      console.log(`✅ Approval successful! Tx: ${approveTx.hash.slice(0, 10)}...`);
    }
    
    // Calculate expiration (3-4 days from now)
    const now = new Date();
    const daysToAdd = Math.floor(Math.random() * 2) + 3;
    const expirationDate = new Date(now.setDate(now.getDate() + daysToAdd));
    const expirationTimestamp = Math.floor(expirationDate.getTime() / 1000);
    
    const data = "0x5068a88a" +
      ethers.zeroPadValue(ethers.toBeHex(amountWei), 32).slice(2) +
      ethers.zeroPadValue(ethers.toBeHex(0), 32).slice(2) +
      ethers.zeroPadValue(ethers.toBeHex(amountWei), 32).slice(2) +
      ethers.zeroPadValue(ethers.toBeHex(expirationTimestamp), 32).slice(2) +
      ethers.zeroPadValue(ethers.toBeHex(500), 32).slice(2) +
      ethers.zeroPadValue(USDC_TOKEN_ADDRESS, 32).slice(2);
    
    const tx = await safeRpcCall(() => wallet.sendTransaction({
      to: DEPOSIT_ROUTER_ADDRESS,
      data,
      gasLimit: 977416
    }), "execute lend");
    
    await safeRpcCall(() => tx.wait(), "wait for lend tx");
    console.log(`✅ Lend successful! Tx: ${tx.hash.slice(0, 10)}...`);
    
  } catch (error) {
    console.error(`❌ Lend failed: ${error.message}`);
  }
}

// Stake
async function stake(wallet, amount) {
  try {
    console.log(`\n🥩 Staking ${amount} KLD...`);
    
    const amountWei = ethers.parseUnits(amount.toString(), 18);
    const kldContract = new ethers.Contract(KLD_TOKEN_ADDRESS, tokenAbi, wallet);
    
    // Check balance
    const balance = await safeRpcCall(() => kldContract.balanceOf(wallet.address), "check KLD balance");
    if (balance < amountWei) {
      throw new Error(`Insufficient KLD balance: ${ethers.formatUnits(balance, 18)} KLD available`);
    }
    
    // Check allowance
    const allowance = await safeRpcCall(() => kldContract.allowance(wallet.address, STAKE_ROUTER_ADDRESS), "check allowance");
    if (allowance < amountWei) {
      console.log(`📝 Approving ${amount} KLD...`);
      const approveTx = await safeRpcCall(() => kldContract.approve(STAKE_ROUTER_ADDRESS, amountWei), "approve KLD");
      await safeRpcCall(() => approveTx.wait(), "wait for approve tx");
      console.log(`✅ Approval successful! Tx: ${approveTx.hash.slice(0, 10)}...`);
    }
    
    const referralAddress = "0x3fb832980638036e81231931cbd48f95a7746d41";
    const data = "0x8340f549" +
      ethers.zeroPadValue(KLD_TOKEN_ADDRESS, 32).slice(2) +
      ethers.zeroPadValue(referralAddress, 32).slice(2) +
      ethers.zeroPadValue(ethers.toBeHex(amountWei), 32).slice(2);
    
    const tx = await safeRpcCall(() => wallet.sendTransaction({
      to: STAKE_ROUTER_ADDRESS,
      data,
      gasLimit: 738930
    }), "execute stake");
    
    await safeRpcCall(() => tx.wait(), "wait for stake tx");
    console.log(`✅ Stake successful! Tx: ${tx.hash.slice(0, 10)}...`);
    
  } catch (error) {
    console.error(`❌ Stake failed: ${error.message}`);
  }
}

// Auto mode activities
async function performAutoActivities(wallet, walletIndex) {
  const walletAddress = wallet.address.slice(0, 8) + "...";
  console.log(`\n👛 [AUTO MODE] Processing Wallet #${walletIndex + 1}: ${walletAddress}`);
  
  await displayBalances(wallet, "Balance Awal");
  
  try {
    // 1. Claim Faucet
    console.log(`\n🔄 Step 1/4: Claiming Faucet`);
    await claimFaucet(wallet);
    if (shouldStop) return;
    await getRandomDelay(5, 15);
    
    // 2. Stake KLD (6000-10000)
    console.log(`\n🔄 Step 2/4: Staking KLD`);
    const stakeAmount = getRandomAmount(6000, 10000);
    await stake(wallet, stakeAmount);
    if (shouldStop) return;
    await getRandomDelay(5, 15);
    
    // 3. Deposit USDC (10-43)
    console.log(`\n🔄 Step 3/4: Depositing USDC`);
    const depositAmount = getRandomAmount(10, 43);
    await depositCollateral(wallet, depositAmount);
    if (shouldStop) return;
    await getRandomDelay(5, 15);
    
    // 4. Lending USDC (10-45)
    console.log(`\n🔄 Step 4/4: Lending USDC`)
    const lendAmount = getRandomAmount(10, 45);
    await lend(wallet, lendAmount);
    
    await displayBalances(wallet, "Balance Akhir");
    console.log(`\n✅ Auto activities completed for Wallet #${walletIndex + 1}`);
    
  } catch (error) {
    if (error.message === "Process stopped by user") {
      console.log(`\n⚠️ Process stopped for Wallet #${walletIndex + 1}`);
    } else {
      console.error(`❌ Error processing wallet #${walletIndex + 1}: ${error.message}`);
    }
  }
}

// Manual mode activities
async function performManualActivity(wallet, walletIndex, activityType, count, minAmount, maxAmount) {
  const walletAddress = wallet.address.slice(0, 8) + "...";
  console.log(`\n👛 [MANUAL MODE] Processing Wallet #${walletIndex + 1}: ${walletAddress}`);
  
  await displayBalances(wallet, "Balance Awal");
  
  try {
    for (let i = 0; i < count; i++) {
      if (shouldStop) break;
      
      console.log(`\n🔄 ${activityType} ${i + 1}/${count}`);
      
      switch (activityType) {
        case 'Stake':
          const stakeAmount = getRandomAmount(minAmount, maxAmount);
          await stake(wallet, stakeAmount);
          break;
        case 'Deposit':
          const depositAmount = getRandomAmount(minAmount, maxAmount);
          await depositCollateral(wallet, depositAmount);
          break;
        case 'Lending':
          const lendAmount = getRandomAmount(minAmount, maxAmount);
          await lend(wallet, lendAmount);
          break;
        case 'Claim Faucet':
          await claimFaucet(wallet);
          break;
      }
      
      if (i < count - 1 && !shouldStop) {
        await getRandomDelay(5, 15);
      }
    }
    
    await displayBalances(wallet, "Balance Akhir");
    console.log(`\n✅ Manual ${activityType} completed for Wallet #${walletIndex + 1}`);
    
  } catch (error) {
    if (error.message === "Process stopped by user") {
      console.log(`\n⚠️ Process stopped for Wallet #${walletIndex + 1}`);
    } else {
      console.error(`❌ Error processing wallet #${walletIndex + 1}: ${error.message}`);
    }
  }
}

// Auto mode loop
async function runAutoMode() {
  console.log(`\n🤖 Starting AUTO MODE`);
  console.log(`📋 Configuration: Claim Faucet → Stake 6000-10000 KLD → Deposit 10-43 USDC → Lending 10-45 USDC`);
  console.log(`🔄 Loop every 65 minutes\n`);
  
  isRunning = true;
  shouldStop = false;
  let cycleCount = 1;
  
  while (!shouldStop) {
    console.log(`\n🔥 ======== CYCLE ${cycleCount} - ${new Date().toLocaleString()} ========`);
    
    // Process all wallets
    for (let i = 0; i < privateKeys.length && !shouldStop; i++) {
      const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;
      
      if (proxy) {
        console.log(`🔄 Using proxy: ${proxy.includes('@') ? '[auth-proxy]' : proxy}`);
      }
      
      const provider = createProvider(proxy);
      const wallet = new ethers.Wallet(privateKeys[i], provider);
      
      await performAutoActivities(wallet, i);
      
      // Delay between wallets (except last wallet)
      if (i < privateKeys.length - 1 && !shouldStop) {
        await getRandomDelay(30, 60);
      }
    }
    
    if (!shouldStop) {
      console.log(`\n✅ Cycle ${cycleCount} completed!`);
      cycleCount++;
      
      // Wait 65 minutes before next cycle
      console.log(`\n⏳ Waiting 65 minutes before next cycle...`);
      const waitTime = 65 * 60; // 65 minutes in seconds
      
      for (let remaining = waitTime; remaining > 0 && !shouldStop; remaining--) {
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;
        
        process.stdout.write(`\r⏰ Next cycle in: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} (Press Ctrl+C to stop)`);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      console.log("");
    }
  }
  
  isRunning = false;
  console.log(`\n🛑 Auto mode stopped.`);
}

// Main menu
async function showMainMenu() {
  while (true) {
    console.log(`\n📋 ===== KALEIDO TESTNET BOT MENU =====`);
    console.log(`1. Auto Mode (Loop every 65 minutes)`);
    console.log(`2. Manual Mode`);
    console.log(`3. Exit`);
    
    const choice = await askQuestion("Pilih opsi (1-3): ");
    
    switch (choice) {
      case '1':
        if (isRunning) {
          console.log(`⚠️ Auto mode is already running!`);
          const stopChoice = await askQuestion("Stop auto mode? (y/n): ");
          if (stopChoice.toLowerCase() === 'y') {
            shouldStop = true;
            console.log(`🛑 Stopping auto mode...`);
            while (isRunning) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        } else {
          await runAutoMode();
        }
        break;
        
      case '2':
        await showManualMenu();
        break;
        
      case '3':
        console.log(`👋 Exiting...`);
        shouldStop = true;
        rl.close();
        process.exit(0);
        
      default:
        console.log(`❌ Invalid choice. Please select 1-3.`);
    }
  }
}

// Manual menu
async function showManualMenu() {
  while (true) {
    console.log(`\n📋 ===== MANUAL MODE MENU =====`);
    console.log(`1 Stake KLD`);
    console.log(`2 Deposit USDC`);
    console.log(`3 Lending USDC`);
    console.log(`4 Claim Faucet`);
    console.log(`5 Back to Main Menu`);
    
    const choice = await askQuestion("Pilih opsi (2-5): ");
    
    let activityType, minAmount, maxAmount, count;
    
    switch (choice) {
      case '1':
        activityType = 'Stake';
        count = parseInt(await askQuestion("Jumlah transaksi Stake: ")) || 1;
        minAmount = parseFloat(await askQuestion("Min amount KLD: ")) || 10;
        maxAmount = parseFloat(await askQuestion("Max amount KLD: ")) || 50;
        break;
        
      case '2':
        activityType = 'Deposit';
        count = parseInt(await askQuestion("Jumlah transaksi Deposit: ")) || 1;
        minAmount = parseFloat(await askQuestion("Min amount USDC: ")) || 0.1;
        maxAmount = parseFloat(await askQuestion("Max amount USDC: ")) || 1;
        break;
        
      case '3':
        activityType = 'Lending';
        count = parseInt(await askQuestion("Jumlah transaksi Lending: ")) || 1;
        minAmount = parseFloat(await askQuestion("Min amount USDC: ")) || 0.1;
        maxAmount = parseFloat(await askQuestion("Max amount USDC: ")) || 1;
        break;
        
      case '4':
        activityType = 'Claim Faucet';
        count = 1; // Faucet can only be claimed once
        minAmount = 0;
        maxAmount = 0;
        break;
        
      case '5':
        return; // Go back to main menu
        
      default:
        console.log(`❌ Invalid choice. Please select 1-5.`);
        continue;
    }
    
    // Execute manual activity
    if (activityType) {
      const useProxyChoice = proxies.length > 0 ? await askQuestion("Gunakan proxy? (y/n): ") : "n";
      const useProxy = useProxyChoice.toLowerCase() === "y";
      
      console.log(`\n📝 Configuration:`);
      console.log(`→ Activity: ${activityType}`);
      console.log(`→ Count: ${count}`);
      if (activityType !== 'Claim Faucet') {
        console.log(`→ Amount Range: ${minAmount} - ${maxAmount}`);
      }
      console.log(`→ Total Wallets: ${privateKeys.length}`);
      console.log(`→ Using Proxy: ${useProxy ? 'Yes' : 'No'}`);
      
      const confirm = await askQuestion("\nLanjutkan? (y/n): ");
      if (confirm.toLowerCase() === 'y') {
        shouldStop = false;
        
        // Process all wallets
        for (let i = 0; i < privateKeys.length && !shouldStop; i++) {
          const proxy = useProxy && proxies.length > 0 ? proxies[i % proxies.length] : null;
          
          if (proxy) {
            console.log(`🔄 Using proxy: ${proxy.includes('@') ? '[auth-proxy]' : proxy}`);
          }
          
          const provider = createProvider(proxy);
          const wallet = new ethers.Wallet(privateKeys[i], provider);
          
          await performManualActivity(wallet, i, activityType, count, minAmount, maxAmount);
          
          // Delay between wallets
          if (i < privateKeys.length - 1 && !shouldStop) {
            await getRandomDelay(30, 60);
          }
        }
        
        console.log(`\n🎉 Manual ${activityType} completed for all wallets!`);
      }
    }
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', (signal) => {
  console.log(`\n\n🛑 Received interrupt signal (Ctrl+C)`);
  shouldStop = true;
  
  if (isRunning) {
    console.log(`⏳ Stopping current operations gracefully...`);
    console.log(`💡 Please wait for current transaction to complete`);
  } else {
    console.log(`👋 Goodbye!`);
    rl.close();
    process.exit(0);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(`\n❌ Uncaught Exception: ${error.message}`);
  console.error(`🔧 Stack: ${error.stack}`);
  shouldStop = true;
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error(`\n❌ Unhandled Rejection at:`, promise, `reason:`, reason);
  shouldStop = true;
});

// Initialize and start the bot
async function initialize() {
  try {
    console.log(`🚀 Initializing Kaleido Testnet Bot...`);
    
    // Load configuration files
    loadPrivateKeys();
    loadProxies();
    
    if (privateKeys.length === 0) {
      console.error(`❌ No valid private keys found. Please check pk.txt file.`);
      console.log(`📝 Format: One private key per line (with or without 0x prefix)`);
      rl.close();
      process.exit(1);
    }
    
    console.log(`\n✅ Initialization completed successfully!`);
    console.log(`📊 Summary:`);
    console.log(`→ Private Keys: ${privateKeys.length}`);
    console.log(`→ Proxies: ${proxies.length}`);
    console.log(`→ Network: Kaleido Testnet (Chain ID: ${KALEIDO_CHAIN_ID})`);
    
    // Test connection to RPC
    console.log(`\n🔗 Testing RPC connection...`);
    const testProvider = createProvider();
    const network = await testProvider.getNetwork();
    console.log(`✅ Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
    
    // Show main menu
    await showMainMenu();
    
  } catch (error) {
    console.error(`❌ Initialization failed: ${error.message}`);
    rl.close();
    process.exit(1);
  }
}

// Start the application
console.log(`🎯 Starting Kaleido Testnet Bot...`);
console.log(`📅 ${new Date().toLocaleString()}`);
console.log(`⚡ Press Ctrl+C to stop at any time\n`);

initialize().catch((error) => {
  console.error(`💥 Fatal error during startup: ${error.message}`);
  process.exit(1);
});
