const { ethers } = require('hardhat')
const { BigNumber, providers, Wallet } = require('ethers')
const {
  getL2Network,
  Erc20Bridger,
  addCustomNetwork,
  L1ToL2MessageStatus,
} = require('@arbitrum/sdk')
const { arbLog, requireEnvVariables } = require('arb-shared-dependencies')
const { expect } = require('chai')
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
 * Set the amount of token to be transferred to L2
 */
const tokenDepositAmount = BigNumber.from(50)

const main = async () => {
  await arbLog('Deposit token using Arbitrum SDK')

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
   * Use l2Network to create an Arbitrum SDK Erc20Bridger instance
   * We'll use Erc20Bridger for its convenience methods around transferring token to L2
   */
  const l2Network = await getL2Network(l2Provider)
  const erc20Bridge = new Erc20Bridger(l2Network)

  console.log(l2Network)

  /**
   * For the purpose of our tests, here we deploy an standard ERC20 token (DappToken) to L1
   * It sends its deployer (us) the initial supply of 1000000000000000
   */
  console.log('Deploying the test DappToken to L1:')
  const L1DappToken = await (
    await ethers.getContractFactory('DappToken')
  ).connect(l1Wallet)
  const l1DappToken = await L1DappToken.deploy(1000000000000000)
  await l1DappToken.deployed()
  console.log(`DappToken is deployed to L1 at ${l1DappToken.address}`)
  console.log('Approving:')
  const erc20Address = l1DappToken.address

  /**
   * We get the address of L1 Gateway for our DappToken, which later helps us to get the initial token balance of Bridge (before deposit)
   */
  const expectedL1GatewayAddress = await erc20Bridge.getL1GatewayAddress(
    erc20Address,
    l1Provider
  )
  const initialBridgeTokenBalance = await l1DappToken.balanceOf(
    expectedL1GatewayAddress
  )

  /**
   * The Standard Gateway contract will ultimately be making the token transfer call; thus, that's the contract we need to approve.
   * erc20Bridge.approveToken handles this approval
   * Arguments required are:
   * (1) l1Signer: The L1 address transferring token to L2
   * (2) erc20L1Address: L1 address of the ERC20 token to be depositted to L2
   */
  const approveTx = await erc20Bridge.approveToken({
    l1Signer: l1Wallet,
    erc20L1Address: erc20Address,
  })

  const approveRec = await approveTx.wait()
  console.log(
    `You successfully allowed the Arbitrum Bridge to spend DappToken ${approveRec.transactionHash}`
  )

  /**
   * Deposit DappToken to L2 using erc20Bridge. This will escrow funds in the Gateway contract on L1, and send a message to mint tokens on L2.
   * The erc20Bridge.deposit method handles computing the necessary fees for automatic-execution of retryable tickets — maxSubmission cost & l2 gas price * gas — and will automatically forward the fees to L2 as callvalue
   * Also note that since this is the first DappToken deposit onto L2, a standard Arb ERC20 contract will automatically be deployed.
   * Arguments required are:
   * (1) amount: The amount of tokens to be transferred to L2
   * (2) erc20L1Address: L1 address of the ERC20 token to be depositted to L2
   * (2) l1Signer: The L1 address transferring token to L2
   * (3) l2Provider: An l2 provider
   */
  const depositTx = await erc20Bridge.deposit({
    amount: tokenDepositAmount,
    erc20L1Address: erc20Address,
    l1Signer: l1Wallet,
    l2Provider: l2Provider,
  })

  /**
   * Now we wait for L1 and L2 side of transactions to be confirmed
   */
  const depositRec = await depositTx.wait()
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
   * Get the Bridge token balance
   */
  const finalBridgeTokenBalance = await l1DappToken.balanceOf(
    expectedL1GatewayAddress
  )

  /**
   * Check if Bridge balance has been updated correctly
   */
  expect(
    initialBridgeTokenBalance
      .add(tokenDepositAmount)
      .eq(finalBridgeTokenBalance),
    'bridge balance not updated after L1 token deposit txn'
  ).to.be.true

  /**
   * Check if our l2Wallet DappToken balance has been updated correctly
   * To do so, we use erc20Bridge to get the l2Token address and contract
   */
  const l2TokenAddress = await erc20Bridge.getL2ERC20Address(
    erc20Address,
    l1Provider
  )
  const l2Token = erc20Bridge.getL2TokenContract(l2Provider, l2TokenAddress)

  const testWalletL2Balance = (
    await l2Token.functions.balanceOf(l2Wallet.address)
  )[0]
  expect(
    testWalletL2Balance.eq(tokenDepositAmount),
    'l2 wallet not updated after deposit'
  ).to.be.true
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
