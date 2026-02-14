// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ProjectEscrow.sol";

/**
 * @title GothamFactory
 * @notice Factory contract for creating and managing project escrows
 * @dev Creates individual ProjectEscrow contracts for each client-developer agreement
 */
contract GothamFactory {
    // Counter for project IDs
    uint256 public projectCount;

    // Mapping from project ID to escrow contract address
    mapping(uint256 => address) public projects;

    // Mapping to track user's projects (client or developer)
    mapping(address => uint256[]) public userProjects;

    // Events
    event ProjectCreated(
        uint256 indexed projectId,
        address indexed escrowContract,
        address indexed client,
        address developer
    );

    event AuditResultSubmitted(
        uint256 indexed projectId,
        address indexed escrowContract,
        uint8 auditIndex,
        bool passed
    );

    /**
     * @notice Create a new project escrow contract
     * @param _client Client address
     * @param _developer Developer address
     * @return projectId The ID of the newly created project
     * @return escrowContract The address of the deployed escrow contract
     */
    function createProject(
        address _client,
        address _developer
    ) external returns (uint256 projectId, address escrowContract) {
        require(_client != address(0), "Invalid client");
        require(_developer != address(0), "Invalid developer");
        require(_client != _developer, "Client and developer must differ");

        projectCount++;
        projectId = projectCount;

        // Deploy new ProjectEscrow contract
        ProjectEscrow escrow = new ProjectEscrow(projectId, _client, _developer);
        escrowContract = address(escrow);

        // Store project
        projects[projectId] = escrowContract;
        userProjects[_client].push(projectId);
        userProjects[_developer].push(projectId);

        emit ProjectCreated(projectId, escrowContract, _client, _developer);

        return (projectId, escrowContract);
    }

    /**
     * @notice Submit AI audit result to a project
     * @dev Called by backend after running AI audits
     * @param _projectId Project ID
     * @param _auditHash Hash of the audit response
     * @param _passed Whether the audit passed
     */
    function submitAuditResult(
        uint256 _projectId,
        bytes32 _auditHash,
        bool _passed
    ) external {
        address escrowAddress = projects[_projectId];
        require(escrowAddress != address(0), "Project not found");

        ProjectEscrow escrow = ProjectEscrow(escrowAddress);

        // Get current audit count before submission
        uint8 auditIndex = escrow.auditCount();

        escrow.submitAuditResult(_auditHash, _passed);

        emit AuditResultSubmitted(_projectId, escrowAddress, auditIndex, _passed);
    }

    /**
     * @notice Get project escrow contract address
     * @param _projectId Project ID
     * @return Escrow contract address
     */
    function getProjectContract(uint256 _projectId) external view returns (address) {
        return projects[_projectId];
    }

    /**
     * @notice Get all project IDs for a user
     * @param _user User address (client or developer)
     * @return Array of project IDs
     */
    function getUserProjects(address _user) external view returns (uint256[] memory) {
        return userProjects[_user];
    }

    /**
     * @notice Get project details
     * @param _projectId Project ID
     */
    function getProjectDetails(uint256 _projectId) external view returns (
        address escrowContract,
        address client,
        address developer,
        uint256 escrowAmount,
        ProjectEscrow.ProjectStatus status,
        uint256 deadline
    ) {
        escrowContract = projects[_projectId];
        require(escrowContract != address(0), "Project not found");

        ProjectEscrow escrow = ProjectEscrow(escrowContract);

        (
            client,
            developer,
            escrowAmount,
            status,
            deadline,
            ,
            ,
        ) = escrow.getProjectDetails();

        return (escrowContract, client, developer, escrowAmount, status, deadline);
    }

    /**
     * @notice Get total number of projects
     */
    function getTotalProjects() external view returns (uint256) {
        return projectCount;
    }
}
