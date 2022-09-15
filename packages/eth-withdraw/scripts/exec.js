const { utils, providers, Wallet } = require('ethers')
const { EthBridger, getL2Network, addCustomNetwork,L2ToL1Message } = require('@arbitrum/sdk')
const { parseEther } = utils
const { arbLog, requireEnvVariables } = require('arb-shared-dependencies')
require('dotenv').config()
requireEnvVariables(['DEVNET_PRIVKEY', 'L2RPC', 'L1RPC'])

/**
 * Set up: instantiate L2 wallet connected to provider
 */
const walletPrivateKey = process.env.DEVNET_PRIVKEY
const l2Provider = new providers.JsonRpcProvider(process.env.L2RPC)
const l2Wallet = new Wallet(walletPrivateKey, l2Provider)

/**
 * Set the amount to be withdrawn from L2 (in wei)
 */
const ethFromL2WithdrawAmount = parseEther('1')

const main = async () => {
  await arbLog('Withdraw Eth via Arbitrum SDK')

  await addCustomNetwork({
    customL1Network: {
      "blockTime": 10,
      "chainID": 1337,
      "explorerUrl": "",
      "isCustom": true,
      "name": "EthLocal",
      "partnerChainIDs": [
        412346
      ],
      "rpcURL": "http://localhost:8545"
    },
    customL2Network: {
      "chainID": 412346,
      "confirmPeriodBlocks": 20,
      "ethBridge": {
        "bridge": "0xb16a6431db6e5c1b03a4db33fea51ec5c0405a92",
        "inbox": "0x5613ed4ee0b64ea8e0632227cbcf857665db7ffe",
        "outbox": "0x1A82de59Ec957D497A7211C28d23149F348459b5",
        "rollup": "0xe75c4f8d357bdfc8b80a85566f79fc1ed25b264e",
        "sequencerInbox": "0x7248bc6769d2b5164af15fa117f16d0f4c0392c3"
      },
      "explorerUrl": "",
      "isArbitrum": true,
      "isCustom": true,
      "name": "ArbLocal",
      "partnerChainID": 1337,
      "rpcURL": "http://localhost:8547",
      "retryableLifetimeSeconds": 604800,
      "tokenBridge": {
        "l1CustomGateway": "0xDe67138B609Fbca38FcC2673Bbc5E33d26C5B584",
        "l1ERC20Gateway": "0x0Bdb0992B3872DF911260BfB60D72607eb22d5d4",
        "l1GatewayRouter": "0x4535771b8D5C43100f126EdACfEc7eb60d391312",
        "l1MultiCall": "0x36BeF5fD671f2aA8686023dE4797A7dae3082D5F",
        "l1ProxyAdmin": "0xF7818cd5f5Dc379965fD1C66b36C0C4D788E7cDB",
        "l1Weth": "0x24067223381F042fF36fb87818196dB4D2C56E9B",
        "l1WethGateway": "0xBa3d12E370a4b592AAF0CA1EF09971D196c27aAd",
        "l2CustomGateway": "0xF0B003F9247f2DC0e874710eD55e55f8C63B14a3",
        "l2ERC20Gateway": "0x78a6dC8D17027992230c112432E42EC3d6838d74",
        "l2GatewayRouter": "0x7b650845242a96595f3a9766D4e8e5ab0887936A",
        "l2Multicall": "0x9b890cA9dE3D317b165afA7DFb8C65f2e4c95C20",
        "l2ProxyAdmin": "0x7F85fB7f42A0c0D40431cc0f7DFDf88be6495e67",
        "l2Weth": "0x36BeF5fD671f2aA8686023dE4797A7dae3082D5F",
        "l2WethGateway": "0x2E76efCC2518CB801E5340d5f140B1c1911b4F4B"
      }
    }
  })

  /**
   * Use l2Network to create an Arbitrum SDK EthBridger instance
   * We'll use EthBridger for its convenience methods around transferring ETH from L2 to L1
   */

  const l2Network = await getL2Network(l2Provider)
  const ethBridger = new EthBridger(l2Network)

  console.log(l2Network)

  /**
   * First, let's check our L2 wallet's initial ETH balance and ensure there's some ETH to withdraw
   */
  const l2WalletInitialEthBalance = await l2Wallet.getBalance()

  if (l2WalletInitialEthBalance.lt(ethFromL2WithdrawAmount)) {
    console.log(
      `Oops - not enough ether; fund your account L2 wallet currently ${l2Wallet.address} with at least 0.000001 ether`
    )
    process.exit(1)
  }
  console.log('Wallet properly funded: initiating withdrawal now')

  /**
   * We're ready to withdraw ETH using the ethBridger instance from Arbitrum SDK
   * It will use our current wallet's address as the default destination
   */

  const withdrawTx = await ethBridger.withdraw({
    amount: ethFromL2WithdrawAmount,
    l2Signer: l2Wallet,
  })
  const withdrawRec = await withdrawTx.wait()

  /**
   * And with that, our withdrawal is initiated! No additional time-sensitive actions are required.
   * Any time after the transaction's assertion is confirmed, funds can be transferred out of the bridge via the outbox contract
   * We'll display the withdrawals event data here:
   */
  console.log(`Ether withdrawal initiated! 🥳 ${withdrawRec.transactionHash}`)

  const withdrawEventsData = await withdrawRec.getL2ToL1Events()
  console.log('Withdrawal data:', withdrawEventsData)
  console.log(
    `To to claim funds (after dispute period), see outbox-execute repo ✌️`
  )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
