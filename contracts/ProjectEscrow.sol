// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProjectEscrow
 * @notice Individual escrow contract for a single client-developer project
 * @dev Created by GothamFactory for each new project
 */
contract ProjectEscrow {
    // Project states
    enum ProjectStatus {
        Negotiating,      // Initial negotiation phase
        ContractSigned,   // Contract signed, awaiting payment
        Funded,           // Payment deposited in escrow
        UnderDevelopment, // Developer working on project
        CodeSubmitted,    // Developer submitted code for review
        AuditPassed,      // AI audit passed
        AuditFailed,      // AI audit failed
        Completed,        // Payment released to developer
        Disputed,         // Manual dispute resolution needed
        Cancelled         // Project cancelled
    }

    // Project participants
    address public immutable client;
    address public immutable developer;
    address public immutable factory;

    // Project details
    uint256 public projectId;
    uint256 public escrowAmount;
    ProjectStatus public status;
    uint256 public deadline;

    // Immutable hashes for verification
    bytes32 public negotiationTermsHash;     // Hash of final negotiation terms
    bytes32 public aiEvaluationPromptHash;   // Immutable AI evaluation prompt hash

    // AI audit consensus (single result from 3 off-chain audits)
    struct ConsensusResult {
        bytes32 consensusHash;  // Combined hash of all 3 audit results
        uint256 timestamp;
        bool passed;
    }
    ConsensusResult public consensus;
    // Removed: consensusSubmitted flag to allow multiple audit retries

    // Timestamps
    uint256 public createdAt;
    uint256 public signedAt;
    uint256 public fundedAt;
    uint256 public submittedAt;
    uint256 public completedAt;

    // Events
    event ProjectCreated(uint256 indexed projectId, address client, address developer);
    event ContractSigned(bytes32 negotiationTermsHash, bytes32 aiPromptHash, uint256 deadline);
    event EscrowFunded(uint256 amount);
    event ConsensusSubmitted(bytes32 consensusHash, bool passed);
    event PaymentReleased(address developer, uint256 amount);
    event ProjectCancelled();
    event DisputeRaised();

    // Modifiers
    modifier onlyClient() {
        require(msg.sender == client, "Only client");
        _;
    }

    modifier onlyDeveloper() {
        require(msg.sender == developer, "Only developer");
        _;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory");
        _;
    }

    modifier inStatus(ProjectStatus _status) {
        require(status == _status, "Invalid status");
        _;
    }

    /**
     * @notice Initialize project escrow
     * @dev Called by factory contract
     */
    constructor(
        uint256 _projectId,
        address _client,
        address _developer
    ) {
        projectId = _projectId;
        client = _client;
        developer = _developer;
        factory = msg.sender;
        status = ProjectStatus.Negotiating;
        createdAt = block.timestamp;

        emit ProjectCreated(_projectId, _client, _developer);
    }

    /**
     * @notice Sign contract after negotiations complete
     * @param _negotiationTermsHash Hash of agreed terms
     * @param _aiPromptHash Immutable AI evaluation prompt hash
     * @param _escrowAmount Payment amount in wei
     * @param _deadline Project completion deadline
     */
    function signContract(
        bytes32 _negotiationTermsHash,
        bytes32 _aiPromptHash,
        uint256 _escrowAmount,
        uint256 _deadline
    ) external onlyClient inStatus(ProjectStatus.Negotiating) {
        require(_negotiationTermsHash != bytes32(0), "Invalid terms hash");
        require(_aiPromptHash != bytes32(0), "Invalid prompt hash");
        require(_escrowAmount > 0, "Invalid amount");
        require(_deadline > block.timestamp, "Invalid deadline");

        negotiationTermsHash = _negotiationTermsHash;
        aiEvaluationPromptHash = _aiPromptHash;
        escrowAmount = _escrowAmount;
        deadline = _deadline;
        status = ProjectStatus.ContractSigned;
        signedAt = block.timestamp;

        emit ContractSigned(_negotiationTermsHash, _aiPromptHash, _deadline);
    }

    /**
     * @notice Client deposits payment into escrow
     */
    function fundEscrow() external payable onlyClient inStatus(ProjectStatus.ContractSigned) {
        require(msg.value == escrowAmount, "Incorrect amount");

        status = ProjectStatus.Funded;
        fundedAt = block.timestamp;

        emit EscrowFunded(msg.value);
    }

    /**
     * @notice Developer starts work (optional status update)
     */
    function startDevelopment() external onlyDeveloper inStatus(ProjectStatus.Funded) {
        status = ProjectStatus.UnderDevelopment;
    }

    /**
     * @notice Submit AI consensus result (called by backend after 3 off-chain audits)
     * @dev Automatically releases payment if consensus passes
     * @param _consensusHash Combined hash of all 3 audit results
     * @param _passed Whether consensus was reached (all 3 audits passed)
     */
    function submitConsensus(
        bytes32 _consensusHash,
        bool _passed
    ) external onlyFactory {
        // Allow multiple submissions until audit passes
        require(
            status == ProjectStatus.Funded ||
            status == ProjectStatus.UnderDevelopment ||
            status == ProjectStatus.CodeSubmitted ||
            status == ProjectStatus.AuditFailed,
            "Invalid status for audit submission"
        );
        require(block.timestamp <= deadline, "Deadline passed");
        require(_consensusHash != bytes32(0), "Invalid hash");

        // Update to CodeSubmitted if not already
        if (status != ProjectStatus.CodeSubmitted && status != ProjectStatus.AuditFailed) {
            status = ProjectStatus.CodeSubmitted;
            submittedAt = block.timestamp;
        }

        // Store latest consensus result
        consensus = ConsensusResult({
            consensusHash: _consensusHash,
            timestamp: block.timestamp,
            passed: _passed
        });

        emit ConsensusSubmitted(_consensusHash, _passed);

        // Auto-release payment if passed
        if (_passed) {
            status = ProjectStatus.AuditPassed;
            _releasePayment();
        } else {
            status = ProjectStatus.AuditFailed;
            // Developer can retry by submitting new code
        }
    }

    /**
     * @notice Release payment to developer
     */
    function _releasePayment() private {
        status = ProjectStatus.Completed;
        completedAt = block.timestamp;

        uint256 amount = escrowAmount;
        escrowAmount = 0;

        (bool success, ) = developer.call{value: amount}("");
        require(success, "Transfer failed");

        emit PaymentReleased(developer, amount);
    }

    /**
     * @notice Raise dispute for manual resolution
     */
    function raiseDispute() external {
        require(msg.sender == client || msg.sender == developer, "Unauthorized");
        require(
            status == ProjectStatus.CodeSubmitted ||
            status == ProjectStatus.AuditFailed,
            "Cannot dispute"
        );

        status = ProjectStatus.Disputed;
        emit DisputeRaised();
    }

    /**
     * @notice Cancel project and refund client (before code submission)
     */
    function cancelProject() external onlyClient {
        require(
            status == ProjectStatus.ContractSigned ||
            status == ProjectStatus.Funded ||
            status == ProjectStatus.UnderDevelopment,
            "Cannot cancel"
        );

        status = ProjectStatus.Cancelled;

        if (escrowAmount > 0) {
            uint256 refund = escrowAmount;
            escrowAmount = 0;
            (bool success, ) = client.call{value: refund}("");
            require(success, "Refund failed");
        }

        emit ProjectCancelled();
    }

    /**
     * @notice Get project details
     */
    function getProjectDetails() external view returns (
        address _client,
        address _developer,
        uint256 _escrowAmount,
        ProjectStatus _status,
        uint256 _deadline,
        bytes32 _negotiationTermsHash,
        bytes32 _aiPromptHash,
        bytes32 _codeHash
    ) {
        return (
            client,
            developer,
            escrowAmount,
            status,
            deadline,
            negotiationTermsHash,
            aiEvaluationPromptHash,
            bytes32(0) // No longer storing code hash
        );
    }

    /**
     * @notice Get consensus result
     */
    function getConsensusResult() external view returns (
        bytes32 _consensusHash,
        uint256 _timestamp,
        bool _passed,
        bool _submitted
    ) {
        return (
            consensus.consensusHash,
            consensus.timestamp,
            consensus.passed,
            consensus.consensusHash != bytes32(0)
        );
    }

    /**
     * @notice Emergency withdrawal (only after significant time passed with no activity)
     */
    function emergencyWithdraw() external onlyClient {
        require(block.timestamp > deadline + 90 days, "Too early");
        require(
            status != ProjectStatus.Completed &&
            status != ProjectStatus.Cancelled,
            "Already resolved"
        );

        uint256 amount = escrowAmount;
        if (amount > 0) {
            escrowAmount = 0;
            (bool success, ) = client.call{value: amount}("");
            require(success, "Withdrawal failed");
        }
    }
}
