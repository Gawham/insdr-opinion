// Contract ABIs for Gotham Platform

export const GOTHAM_FACTORY_ABI = [
    {
        "inputs": [
            { "internalType": "address", "name": "_client", "type": "address" },
            { "internalType": "address", "name": "_developer", "type": "address" }
        ],
        "name": "createProject",
        "outputs": [
            { "internalType": "uint256", "name": "projectId", "type": "uint256" },
            { "internalType": "address", "name": "escrowContract", "type": "address" }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "_projectId", "type": "uint256" }
        ],
        "name": "getProjectContract",
        "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address", "name": "_user", "type": "address" }
        ],
        "name": "getUserProjects",
        "outputs": [{ "internalType": "uint256[]", "name": "", "type": "uint256[]" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "_projectId", "type": "uint256" }
        ],
        "name": "getProjectDetails",
        "outputs": [
            { "internalType": "address", "name": "escrowContract", "type": "address" },
            { "internalType": "address", "name": "client", "type": "address" },
            { "internalType": "address", "name": "developer", "type": "address" },
            { "internalType": "uint256", "name": "escrowAmount", "type": "uint256" },
            { "internalType": "uint8", "name": "status", "type": "uint8" },
            { "internalType": "uint256", "name": "deadline", "type": "uint256" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getTotalProjects",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": true, "internalType": "uint256", "name": "projectId", "type": "uint256" },
            { "indexed": true, "internalType": "address", "name": "escrowContract", "type": "address" },
            { "indexed": true, "internalType": "address", "name": "client", "type": "address" },
            { "indexed": false, "internalType": "address", "name": "developer", "type": "address" }
        ],
        "name": "ProjectCreated",
        "type": "event"
    }
];

export const PROJECT_ESCROW_ABI = [
    {
        "inputs": [
            { "internalType": "bytes32", "name": "_negotiationTermsHash", "type": "bytes32" },
            { "internalType": "bytes32", "name": "_aiPromptHash", "type": "bytes32" },
            { "internalType": "uint256", "name": "_escrowAmount", "type": "uint256" },
            { "internalType": "uint256", "name": "_deadline", "type": "uint256" }
        ],
        "name": "signContract",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "fundEscrow",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "bytes32", "name": "_codeHash", "type": "bytes32" }
        ],
        "name": "submitCode",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "bytes32", "name": "_auditHash", "type": "bytes32" },
            { "internalType": "bool", "name": "_passed", "type": "bool" }
        ],
        "name": "submitAuditResult",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getProjectDetails",
        "outputs": [
            { "internalType": "address", "name": "_client", "type": "address" },
            { "internalType": "address", "name": "_developer", "type": "address" },
            { "internalType": "uint256", "name": "_escrowAmount", "type": "uint256" },
            { "internalType": "uint8", "name": "_status", "type": "uint8" },
            { "internalType": "uint256", "name": "_deadline", "type": "uint256" },
            { "internalType": "bytes32", "name": "_negotiationTermsHash", "type": "bytes32" },
            { "internalType": "bytes32", "name": "_aiPromptHash", "type": "bytes32" },
            { "internalType": "bytes32", "name": "_codeHash", "type": "bytes32" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getAuditResults",
        "outputs": [
            {
                "components": [
                    { "internalType": "bytes32", "name": "auditHash", "type": "bytes32" },
                    { "internalType": "uint256", "name": "timestamp", "type": "uint256" },
                    { "internalType": "bool", "name": "passed", "type": "bool" }
                ],
                "internalType": "struct ProjectEscrow.AuditResult[3]",
                "name": "",
                "type": "tuple[3]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];
