const { providers, Wallet } = require('ethers')
const hre = require('hardhat')
const ethers = require('ethers')
const { hexDataLength } = require('@ethersproject/bytes')
const {
  L1ToL2MessageGasEstimator,
} = require('@arbitrum/sdk/dist/lib/message/L1ToL2MessageGasEstimator')
const { arbLog, requireEnvVariables } = require('arb-shared-dependencies')
const {
  L1TransactionReceipt,
  L1ToL2MessageStatus,
  EthBridger,
  addCustomNetwork,
  getL2Network,
} = require('@arbitrum/sdk')
requireEnvVariables(['DEVNET_PRIVKEY', 'L2RPC', 'L1RPC'])

/**
 * Set up: instantiate L1 / L2 wallets connected to providers
 */
const walletPrivateKey = process.env.DEVNET_PRIVKEY

const l1Provider = new providers.JsonRpcProvider(process.env.L1RPC)
const l2Provider = new providers.JsonRpcProvider(process.env.L2RPC)

const l1Wallet = new Wallet(walletPrivateKey, l1Provider)
const l2Wallet = new Wallet(walletPrivateKey, l2Provider)

const main = async () => {
  await arbLog('Cross-chain Greeter')

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
        "bridge": "0xdd041cddc4ea2655627d9d907e01f40490c3bd89",
        "inbox": "0xdc8bb4dad70459f076f3484cc8c43722cae36a01",
        "outbox": "0xb6bE947DCA31b096Dc1041aC30e806A6F13Bf871",
        "rollup": "0xc2add8f204679376f36c16cf3b9f588b8551bc83",
        "sequencerInbox": "0xcf7feadc1e76f98ebd3a5d00192002069463fb35"
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
   * We'll use EthBridger to retrieve the Inbox address
   */

  const l2Network = await getL2Network(l2Provider)
  const ethBridger = new EthBridger(l2Network)
  const inboxAddress = ethBridger.l2Network.ethBridge.inbox

  console.log(l2Network)

  /**
   * We deploy L1 Greeter to L1, L2 greeter to L2, each with a different "greeting" message.
   * After deploying, save set each contract's counterparty's address to its state so that they can later talk to each other.
   */
  const L1Greeter = await (
    await hre.ethers.getContractFactory('GreeterL1')
  ).connect(l1Wallet) //
  console.log('Deploying L1 Greeter 👋')
  const l1Greeter = await L1Greeter.deploy(
    'Hello world in L1',
    ethers.constants.AddressZero, // temp l2 addr
    inboxAddress
  )
  await l1Greeter.deployed()
  console.log(`deployed to ${l1Greeter.address}`)
  const L2Greeter = await (
    await hre.ethers.getContractFactory('GreeterL2')
  ).connect(l2Wallet)

  console.log('Deploying L2 Greeter 👋👋')

  const l2Greeter = await L2Greeter.deploy(
    'Hello world in L2',
    ethers.constants.AddressZero // temp l1 addr
  )
  await l2Greeter.deployed()
  console.log(`deployed to ${l2Greeter.address}`)

  const updateL1Tx = await l1Greeter.updateL2Target(l2Greeter.address)
  await updateL1Tx.wait()

  const updateL2Tx = await l2Greeter.updateL1Target(l1Greeter.address)
  await updateL2Tx.wait()
  console.log('Counterpart contract addresses set in both greeters 👍')

  /**
   * Let's log the L2 greeting string
   */
  const currentL2Greeting = await l2Greeter.greet()
  console.log(`Current L2 greeting: "${currentL2Greeting}"`)

  console.log('Updating greeting from L1 to L2:')

  /**
   * Here we have a new greeting message that we want to set as the L2 greeting; we'll be setting it by sending it as a message from layer 1!!!
   */
  const newGreeting = 'Greeting from far, far away'

  /**
   * To send an L1-to-L2 message (aka a "retryable ticket"), we need to send ether from L1 to pay for the txn costs on L2.
   * There are two costs we need to account for: base submission cost and cost of L2 execution. We'll start with base submission cost.
   */

  /**
   * Base submission cost is a special cost for creating a retryable ticket; querying the cost requires us to know how many bytes of calldata out retryable ticket will require, so let's figure that out.
   * We'll get the bytes for our greeting data, then add 4 for the 4-byte function signature.
   */

  const newGreetingBytes = ethers.utils.defaultAbiCoder.encode(
    ['string'],
    [newGreeting]
  )
  const newGreetingBytesLength = hexDataLength(newGreetingBytes) + 4 // 4 bytes func identifier

  /**
   * Now we can query the submission price using a helper method; the first value returned tells us the best cost of our transaction; that's what we'll be using.
   * The second value (nextUpdateTimestamp) tells us when the base cost will next update (base cost changes over time with chain congestion; the value updates every 24 hours). We won't actually use it here, but generally it's useful info to have.
   */
  const l1ToL2MessageGasEstimate = new L1ToL2MessageGasEstimator(l2Provider)

  const _submissionPriceWei =
    await l1ToL2MessageGasEstimate.estimateSubmissionFee(
      l1Provider,
      await l1Provider.getGasPrice(),
      newGreetingBytesLength
    )

  console.log(
    `Current retryable base submission price: ${_submissionPriceWei.toString()}`
  )

  /**
   * ...Okay, but on the off chance we end up underpaying, our retryable ticket simply fails.
   * This is highly unlikely, but just to be safe, let's increase the amount we'll be paying (the difference between the actual cost and the amount we pay gets refunded to our address on L2 anyway)
   * In nitro, submission fee will be charged in L1 based on L1 basefee, revert on L1 side upon insufficient fee.
   */
  const submissionPriceWei = _submissionPriceWei.mul(5)
  /**
   * Now we'll figure out the gas we need to send for L2 execution; this requires the L2 gas price and gas limit for our L2 transaction
   */

  /**
   * For the L2 gas price, we simply query it from the L2 provider, as we would when using L1
   */
  const gasPriceBid = await l2Provider.getGasPrice()
  console.log(`L2 gas price: ${gasPriceBid.toString()}`)

  /**
   * For the gas limit, we'll use the estimateRetryableTicketGasLimit method in Arbitrum SDK
   */

  /**
   * First, we need to calculate the calldata for the function being called (setGreeting())
   */
  const ABI = ['function setGreeting(string _greeting)']
  const iface = new ethers.utils.Interface(ABI)
  const calldata = iface.encodeFunctionData('setGreeting', [newGreeting])

  const maxGas = await l1ToL2MessageGasEstimate.estimateRetryableTicketGasLimit(
    l1Greeter.address,
    l2Greeter.address,
    0,
    l2Wallet.address,
    l2Wallet.address,
    calldata,
    ethers.utils.parseEther('1')
  )
  /**
   * With these three values, we can calculate the total callvalue we'll need our L1 transaction to send to L2
   */
  const callValue = submissionPriceWei.add(gasPriceBid.mul(maxGas))

  console.log(
    `Sending greeting to L2 with ${callValue.toString()} callValue for L2 fees:`
  )

  const setGreetingTx = await l1Greeter.setGreetingInL2(
    newGreeting, // string memory _greeting,
    submissionPriceWei,
    maxGas,
    gasPriceBid,
    {
      value: callValue,
    }
  )
  const setGreetingRec = await setGreetingTx.wait()

  console.log(
    `Greeting txn confirmed on L1! 🙌 ${setGreetingRec.transactionHash}`
  )

  const l1TxReceipt = new L1TransactionReceipt(setGreetingRec)

  /**
   * In principle, a single L1 txn can trigger any number of L1-to-L2 messages (each with its own sequencer number).
   * In this case, we know our txn triggered only one
   * Here, We check if our L1 to L2 message is redeemed on L2
   */
  const message = await l1TxReceipt.getL1ToL2Message(l2Wallet)
  const status = await message.waitForStatus()
  console.log(status)
  if (status === L1ToL2MessageStatus.REDEEMED) {
    console.log(`L2 retryable txn executed 🥳 ${message.l2TxHash}`)
  } else {
    console.log(
      `L2 retryable txn failed with status ${L1ToL2MessageStatus[status]}`
    )
  }

  /**
   * Note that during L2 execution, a retryable's sender address is transformed to its L2 alias.
   * Thus, when GreeterL2 checks that the message came from the L1, we check that the sender is this L2 Alias.
   * See setGreeting in GreeterL2.sol for this check.
   */

  /**
   * Now when we call greet again, we should see our new string on L2!
   */
  const newGreetingL2 = await l2Greeter.greet()
  console.log(`Updated L2 greeting: "${newGreetingL2}"`)
  console.log('✌️')
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
