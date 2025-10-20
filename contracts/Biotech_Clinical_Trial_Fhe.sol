pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract BiotechClinicalTrialFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error BatchNotClosed();
    error InvalidParameter();
    error ReplayDetected();
    error StateMismatch();
    error DecryptionFailed();
    error NotInitialized();

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Batch {
        uint256 id;
        bool open;
        uint256 totalEncryptedResponses;
        euint32 encryptedTotalResponseSum;
    }
    uint256 public currentBatchId;
    mapping(uint256 => Batch) public batches;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSecondsSet(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event ResponseSubmitted(address indexed provider, uint256 indexed batchId, uint256 responseCount);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalResponseSum);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier respectCooldown(address caller, mapping(address => uint256) storage lastCallTime) {
        if (block.timestamp < lastCallTime[caller] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastCallTime[caller] = block.timestamp;
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        _initializeFHE();
    }

    function _initializeFHE() internal {
        // Initialize FHE library if needed
        // This is a placeholder; actual FHE initialization might differ
        // For Zama FHEVM, this is typically handled by inheriting from a config contract like SepoliaConfig
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        isProvider[provider] = false;
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        if (paused == _paused) revert InvalidParameter();
        paused = _paused;
        if (_paused) {
            emit Paused(msg.sender);
        } else {
            emit Unpaused(msg.sender);
        }
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == cooldownSeconds) revert InvalidParameter();
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldown, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        Batch storage newBatch = batches[currentBatchId];
        newBatch.id = currentBatchId;
        newBatch.open = true;
        newBatch.totalEncryptedResponses = FHE.asEuint32(0);
        newBatch.encryptedTotalResponseSum = FHE.asEuint32(0);
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner whenNotPaused {
        if (batchId != currentBatchId) revert InvalidParameter(); // Can only close the current batch
        Batch storage batch = batches[batchId];
        if (!batch.open) revert BatchClosed();
        batch.open = false;
        emit BatchClosed(batchId);
    }

    function _requireInitialized(euint32 value) internal view {
        if (!value.isInitialized()) revert NotInitialized();
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function submitEncryptedResponses(uint256 batchId, euint32[] calldata encryptedResponses) external onlyProvider whenNotPaused respectCooldown(msg.sender, lastSubmissionTime) {
        Batch storage batch = batches[batchId];
        if (!batch.open) revert BatchClosed();

        for (uint256 i = 0; i < encryptedResponses.length; i++) {
            _requireInitialized(encryptedResponses[i]);
            batch.encryptedTotalResponseSum = batch.encryptedTotalResponseSum.add(encryptedResponses[i]);
        }
        batch.totalEncryptedResponses = batch.totalEncryptedResponses.add(FHE.asEuint32(encryptedResponses.length));

        emit ResponseSubmitted(msg.sender, batchId, encryptedResponses.length);
    }

    function requestBatchSummaryDecryption(uint256 batchId) external onlyOwner whenNotPaused respectCooldown(msg.sender, lastDecryptionRequestTime) {
        Batch storage batch = batches[batchId];
        if (batch.open) revert BatchNotClosed(); // Batch must be closed for summary

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = batch.totalEncryptedResponses.toBytes32();
        cts[1] = batch.encryptedTotalResponseSum.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        // @dev Replay protection: ensure this callback hasn't been processed for this requestId
        if (decryptionContexts[requestId].processed) revert ReplayDetected();

        // @dev State verification: ensure the contract state relevant to this decryption request hasn't changed
        // since the request was made. This prevents decrypting stale or inconsistent data.
        DecryptionContext storage ctx = decryptionContexts[requestId];
        Batch storage batch = batches[ctx.batchId];

        bytes32[] memory currentCts = new bytes32[](2);
        currentCts[0] = batch.totalEncryptedResponses.toBytes32();
        currentCts[1] = batch.encryptedTotalResponseSum.toBytes32();

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != ctx.stateHash) {
            revert StateMismatch();
        }

        // @dev Proof verification: ensure the decryption proof is valid for the ciphertexts and cleartexts
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode cleartexts in the same order they were encrypted
        (bytes32 totalResponsesCleartext, bytes32 totalResponseSumCleartext) = abi.decode(cleartexts, (bytes32, bytes32));

        uint256 totalResponses = uint256(totalResponsesCleartext);
        uint256 totalResponseSum = uint256(totalResponseSumCleartext);

        // Finalize
        ctx.processed = true;
        emit DecryptionCompleted(requestId, ctx.batchId, totalResponseSum);
        // Further actions with cleartexts (e.g., storing, emitting) can be added here
    }
}