// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LegalCourtFHE is SepoliaConfig {
    struct EncryptedCase {
        uint256 caseId;
        euint32 encryptedDocuments;  // Encrypted legal documents
        euint32 encryptedEvidence;  // Encrypted evidence files
        euint32 encryptedMetadata;  // Encrypted case metadata
        uint256 timestamp;
    }

    struct EncryptedVerification {
        uint256 verificationId;
        euint32 encryptedConsistency; // Encrypted consistency score
        euint32 encryptedValidity;   // Encrypted validity score
        uint256 caseId;
        uint256 verifiedAt;
    }

    struct DecryptedResult {
        uint32 consistencyScore;
        uint32 validityScore;
        bool isRevealed;
    }

    uint256 public caseCount;
    uint256 public verificationCount;
    mapping(uint256 => EncryptedCase) public encryptedCases;
    mapping(uint256 => EncryptedVerification) public encryptedVerifications;
    mapping(uint256 => DecryptedResult) public decryptedResults;
    
    mapping(uint256 => uint256) private requestToCaseId;
    mapping(uint256 => uint256) private verificationRequestToId;
    
    event CaseFiled(uint256 indexed caseId, uint256 timestamp);
    event VerificationRequested(uint256 indexed requestId, uint256 caseId);
    event VerificationCompleted(uint256 indexed verificationId);
    event ResultDecrypted(uint256 indexed verificationId);

    modifier onlyJudge() {
        // Add proper judge authentication in production
        _;
    }

    modifier onlyParty(uint256 caseId) {
        // Add proper party authentication in production
        _;
    }

    function fileEncryptedCase(
        euint32 encryptedDocuments,
        euint32 encryptedEvidence,
        euint32 encryptedMetadata
    ) public {
        caseCount += 1;
        uint256 newCaseId = caseCount;
        
        encryptedCases[newCaseId] = EncryptedCase({
            caseId: newCaseId,
            encryptedDocuments: encryptedDocuments,
            encryptedEvidence: encryptedEvidence,
            encryptedMetadata: encryptedMetadata,
            timestamp: block.timestamp
        });
        
        emit CaseFiled(newCaseId, block.timestamp);
    }

    function requestEvidenceVerification(uint256 caseId) public onlyJudge {
        EncryptedCase storage legalCase = encryptedCases[caseId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(legalCase.encryptedDocuments);
        ciphertexts[1] = FHE.toBytes32(legalCase.encryptedEvidence);
        ciphertexts[2] = FHE.toBytes32(legalCase.encryptedMetadata);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.verifyEvidence.selector);
        requestToCaseId[reqId] = caseId;
        
        emit VerificationRequested(reqId, caseId);
    }

    function verifyEvidence(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 caseId = requestToCaseId[requestId];
        require(caseId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory documents, string memory evidence, string memory metadata) = 
            abi.decode(cleartexts, (string, string, string));
        
        // Simulate FHE evidence verification (in production this would be done off-chain)
        verificationCount += 1;
        uint256 newVerificationId = verificationCount;
        
        // Simplified verification metrics
        uint32 consistency = calculateConsistency(documents, evidence);
        uint32 validity = calculateValidity(evidence, metadata);
        
        encryptedVerifications[newVerificationId] = EncryptedVerification({
            verificationId: newVerificationId,
            encryptedConsistency: FHE.asEuint32(consistency),
            encryptedValidity: FHE.asEuint32(validity),
            caseId: caseId,
            verifiedAt: block.timestamp
        });
        
        decryptedResults[newVerificationId] = DecryptedResult({
            consistencyScore: consistency,
            validityScore: validity,
            isRevealed: false
        });
        
        emit VerificationCompleted(newVerificationId);
    }

    function requestVerificationResult(uint256 verificationId) public onlyJudge {
        EncryptedVerification storage verification = encryptedVerifications[verificationId];
        require(!decryptedResults[verificationId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(verification.encryptedConsistency);
        ciphertexts[1] = FHE.toBytes32(verification.encryptedValidity);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptVerification.selector);
        verificationRequestToId[reqId] = verificationId;
    }

    function decryptVerification(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 verificationId = verificationRequestToId[requestId];
        require(verificationId != 0, "Invalid request");
        
        DecryptedResult storage dResult = decryptedResults[verificationId];
        require(!dResult.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 consistency, uint32 validity) = abi.decode(cleartexts, (uint32, uint32));
        
        dResult.consistencyScore = consistency;
        dResult.validityScore = validity;
        dResult.isRevealed = true;
        
        emit ResultDecrypted(verificationId);
    }

    function getDecryptedResult(uint256 verificationId) public view returns (
        uint32 consistencyScore,
        uint32 validityScore,
        bool isRevealed
    ) {
        DecryptedResult storage r = decryptedResults[verificationId];
        return (r.consistencyScore, r.validityScore, r.isRevealed);
    }

    function getEncryptedCase(uint256 caseId) public view returns (
        euint32 documents,
        euint32 evidence,
        euint32 metadata,
        uint256 timestamp
    ) {
        EncryptedCase storage c = encryptedCases[caseId];
        return (c.encryptedDocuments, c.encryptedEvidence, c.encryptedMetadata, c.timestamp);
    }

    function getEncryptedVerification(uint256 verificationId) public view returns (
        euint32 consistency,
        euint32 validity,
        uint256 caseId,
        uint256 verifiedAt
    ) {
        EncryptedVerification storage v = encryptedVerifications[verificationId];
        return (v.encryptedConsistency, v.encryptedValidity, v.caseId, v.verifiedAt);
    }

    // Helper functions for demo purposes
    function calculateConsistency(string memory documents, string memory evidence) private pure returns (uint32) {
        // Simplified consistency check between documents and evidence
        bytes memory docBytes = bytes(documents);
        bytes memory eviBytes = bytes(evidence);
        uint32 matches = 0;
        
        for (uint i = 0; i < docBytes.length && i < eviBytes.length; i++) {
            if (docBytes[i] == eviBytes[i]) {
                matches++;
            }
        }
        
        return matches * 100 / uint32(docBytes.length > 0 ? docBytes.length : 1);
    }

    function calculateValidity(string memory evidence, string memory metadata) private pure returns (uint32) {
        // Simplified validity check based on metadata
        bytes memory eviBytes = bytes(evidence);
        bytes memory metaBytes = bytes(metadata);
        uint32 score = 0;
        
        if (metaBytes.length > 10) {
            score = 70; // Base validity score
            if (eviBytes.length > metaBytes.length / 2) {
                score += 20;
            }
        }
        
        return score > 100 ? 100 : score;
    }
}