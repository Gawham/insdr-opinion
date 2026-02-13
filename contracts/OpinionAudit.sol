// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract OpinionAudit {
    struct Request {
        bytes32 requestId;
        bytes32 contextHash;
        string modelId;
        bytes32 outputHash;
        address requester;
        uint256 timestamp;
    }

    mapping(bytes32 => Request) public requests;
    bytes32[] public requestIds;

    event RequestSubmitted(
        bytes32 indexed requestId,
        bytes32 contextHash,
        string modelId,
        bytes32 outputHash,
        address requester
    );

    function submitRequest(bytes32 _contextHash, string calldata _modelId, bytes32 _outputHash) external returns (bytes32) {
        bytes32 requestId = keccak256(abi.encodePacked(block.timestamp, msg.sender, _contextHash, _outputHash));
        
        requests[requestId] = Request({
            requestId: requestId,
            contextHash: _contextHash,
            modelId: _modelId,
            outputHash: _outputHash,
            requester: msg.sender,
            timestamp: block.timestamp
        });
        
        requestIds.push(requestId);
        
        emit RequestSubmitted(requestId, _contextHash, _modelId, _outputHash, msg.sender);
        
        return requestId;
    }

    function getRequest(bytes32 _requestId) external view returns (Request memory) {
        return requests[_requestId];
    }
}
