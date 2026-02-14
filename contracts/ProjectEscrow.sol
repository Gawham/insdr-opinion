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
    bytes32 public codeRepositoryHash;       // Hash of submitted code repository

    // AI audit results (requires 3/3 consensus)
    struct AuditResult {
        bytes32 auditHash;
        uint256 timestamp;
        bool passed;
    }
    AuditResult[3] public auditResults;
    uint8 public auditCount;

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
    event CodeSubmitted(bytes32 codeHash);
    event AuditSubmitted(uint8 auditIndex, bytes32 auditHash, bool passed);
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
     * @notice Developer submits completed code
     * @param _codeHash Hash of the code repository
     */
    function submitCode(bytes32 _codeHash) external onlyDeveloper {
        require(
            status == ProjectStatus.Funded || status == ProjectStatus.UnderDevelopment,
            "Invalid status"
        );
        require(_codeHash != bytes32(0), "Invalid code hash");
        require(block.timestamp <= deadline, "Deadline passed");

        codeRepositoryHash = _codeHash;
        status = ProjectStatus.CodeSubmitted;
        submittedAt = block.timestamp;

        emit CodeSubmitted(_codeHash);
    }

    /**
     * @notice Submit AI audit result (called by backend)
     * @param _auditHash Hash of the audit response
     * @param _passed Whether audit passed
     */
    function submitAuditResult(
        bytes32 _auditHash,
        bool _passed
    ) external onlyFactory inStatus(ProjectStatus.CodeSubmitted) {
        require(auditCount < 3, "All audits submitted");

        auditResults[auditCount] = AuditResult({
            auditHash: _auditHash,
            timestamp: block.timestamp,
            passed: _passed
        });

        emit AuditSubmitted(auditCount, _auditHash, _passed);
        auditCount++;

        // Check if all 3 audits are complete
        if (auditCount == 3) {
            _evaluateAudits();
        }
    }

    /**
     * @notice Evaluate audit consensus and release payment if passed
     * @dev Requires all 3 audits to pass (3/3 consensus)
     */
    function _evaluateAudits() private {
        uint8 passCount = 0;

        for (uint8 i = 0; i < 3; i++) {
            if (auditResults[i].passed) {
                passCount++;
            }
        }

        // Require unanimous consensus (3/3)
        if (passCount == 3) {
            status = ProjectStatus.AuditPassed;
            _releasePayment();
        } else {
            status = ProjectStatus.AuditFailed;
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
            codeRepositoryHash
        );
    }

    /**
     * @notice Get all audit results
     */
    function getAuditResults() external view returns (AuditResult[3] memory) {
        return auditResults;
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
