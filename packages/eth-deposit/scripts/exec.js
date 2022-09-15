const { utils, providers, Wallet } = require('ethers')
const {
  EthBridger,
  getL2Network,
  addCustomNetwork,
  L1ToL2MessageStatus,
} = require('@arbitrum/sdk')
const { parseEther } = utils
const { arbLog, requireEnvVariables } = require('arb-shared-dependencies')
require('dotenv').config()
requireEnvVariables(['DEVNET_PRIVKEY', 'L1RPC', 'L2RPC'])

/**
 * Set up: instantiate L1 / L2 wallets connected to providers
 */
const walletPrivateKey = process.env.DEVNET_PRIVKEY

const l1Provider = new providers.JsonRpcProvider(process.env.L1RPC)
const l2Provider = new providers.JsonRpcProvider(process.env.L2RPC)

const l1Wallet = new Wallet(walletPrivateKey, l1Provider)
const l2Wallet = new Wallet(walletPrivateKey, l2Provider)

/**
 * Set the amount to be deposited in L2 (in wei)
 */
const ethToL2DepositAmount = parseEther('10')

const main = async () => {
  await arbLog('Deposit Eth via Arbitrum SDK')


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
   * We'll use EthBridger for its convenience methods around transferring ETH to L2
   */
  const l2Network = await getL2Network(l2Provider)
  const ethBridger = new EthBridger(l2Network)

  console.log(l2Network)

  /**
   * First, let's check the l2Wallet initial ETH balance
   */
  const l2WalletInitialEthBalance = await l2Wallet.getBalance()

  /**
   * transfer ether from L1 to L2
   * This convenience method automatically queries for the retryable's max submission cost and forwards the appropriate amount to L2
   * Arguments required are:
   * (1) amount: The amount of ETH to be transferred to L2
   * (2) l1Signer: The L1 address transferring ETH to L2
   * (3) l2Provider: An l2 provider
   */
  const depositTx = await ethBridger.deposit({
    amount: ethToL2DepositAmount,
    l1Signer: l1Wallet,
    l2Provider: l2Provider,
  })

  const depositRec = await depositTx.wait()
  console.warn('deposit L1 receipt is:', depositRec.transactionHash)

  /**
   * With the transaction confirmed on L1, we now wait for the L2 side (i.e., balance credited to L2) to be confirmed as well.
   * Here we're waiting for the Sequencer to include the L2 message in its off-chain queue. The Sequencer should include it in under 10 minutes.
   */
  console.warn('Now we wait for L2 side of the transaction to be executed ⏳')
  const l2Result = await depositRec.waitForL2(l2Provider)

  /**
   * The `complete` boolean tells us if the l1 to l2 message was successul
   */
  l2Result.complete
    ? console.log(
        `L2 message successful: status: ${L1ToL2MessageStatus[l2Result.status]}`
      )
    : console.log(
        `L2 message failed: status ${L1ToL2MessageStatus[l2Result.status]}`
      )

  /**
   * Our l2Wallet ETH balance should be updated now
   */
  const l2WalletUpdatedEthBalance = await l2Wallet.getBalance()
  console.log(
    `your L2 ETH balance is updated from ${l2WalletInitialEthBalance.toString()} to ${l2WalletUpdatedEthBalance.toString()}`
  )
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
