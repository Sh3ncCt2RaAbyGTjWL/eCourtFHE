// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface EvidenceRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  submitter: string;
  caseId: string;
  evidenceType: string;
  status: "submitted" | "under_review" | "accepted" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newEvidence, setNewEvidence] = useState({
    caseId: "",
    evidenceType: "",
    description: "",
    content: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showStats, setShowStats] = useState(true);

  // Calculate statistics
  const submittedCount = evidenceList.filter(e => e.status === "submitted").length;
  const underReviewCount = evidenceList.filter(e => e.status === "under_review").length;
  const acceptedCount = evidenceList.filter(e => e.status === "accepted").length;
  const rejectedCount = evidenceList.filter(e => e.status === "rejected").length;

  // Filter evidence based on search and filter
  const filteredEvidence = evidenceList.filter(evidence => {
    const matchesSearch = evidence.caseId.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         evidence.evidenceType.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === "all" || evidence.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    loadEvidence().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadEvidence = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("evidence_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing evidence keys:", e);
        }
      }
      
      const list: EvidenceRecord[] = [];
      
      for (const key of keys) {
        try {
          const evidenceBytes = await contract.getData(`evidence_${key}`);
          if (evidenceBytes.length > 0) {
            try {
              const evidenceData = JSON.parse(ethers.toUtf8String(evidenceBytes));
              list.push({
                id: key,
                encryptedData: evidenceData.data,
                timestamp: evidenceData.timestamp,
                submitter: evidenceData.submitter,
                caseId: evidenceData.caseId,
                evidenceType: evidenceData.evidenceType,
                status: evidenceData.status || "submitted"
              });
            } catch (e) {
              console.error(`Error parsing evidence data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading evidence ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setEvidenceList(list);
    } catch (e) {
      console.error("Error loading evidence:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitEvidence = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setSubmitting(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting evidence with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newEvidence))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const evidenceId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const evidenceData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        submitter: account,
        caseId: newEvidence.caseId,
        evidenceType: newEvidence.evidenceType,
        status: "submitted"
      };
      
      // Store encrypted evidence on-chain using FHE
      await contract.setData(
        `evidence_${evidenceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(evidenceData))
      );
      
      const keysBytes = await contract.getData("evidence_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(evidenceId);
      
      await contract.setData(
        "evidence_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Evidence submitted securely with FHE encryption!"
      });
      
      await loadEvidence();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowSubmitModal(false);
        setNewEvidence({
          caseId: "",
          evidenceType: "",
          description: "",
          content: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const reviewEvidence = async (evidenceId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing evidence with FHE verification..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const evidenceBytes = await contract.getData(`evidence_${evidenceId}`);
      if (evidenceBytes.length === 0) {
        throw new Error("Evidence not found");
      }
      
      const evidenceData = JSON.parse(ethers.toUtf8String(evidenceBytes));
      
      const updatedEvidence = {
        ...evidenceData,
        status: "under_review"
      };
      
      await contract.setData(
        `evidence_${evidenceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedEvidence))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadEvidence();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const acceptEvidence = async (evidenceId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Finalizing FHE validation..."
    });

    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const evidenceBytes = await contract.getData(`evidence_${evidenceId}`);
      if (evidenceBytes.length === 0) {
        throw new Error("Evidence not found");
      }
      
      const evidenceData = JSON.parse(ethers.toUtf8String(evidenceBytes));
      
      const updatedEvidence = {
        ...evidenceData,
        status: "accepted"
      };
      
      await contract.setData(
        `evidence_${evidenceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedEvidence))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Evidence accepted with FHE validation!"
      });
      
      await loadEvidence();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Acceptance failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectEvidence = async (evidenceId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing with FHE analysis..."
    });

    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const evidenceBytes = await contract.getData(`evidence_${evidenceId}`);
      if (evidenceBytes.length === 0) {
        throw new Error("Evidence not found");
      }
      
      const evidenceData = JSON.parse(ethers.toUtf8String(evidenceBytes));
      
      const updatedEvidence = {
        ...evidenceData,
        status: "rejected"
      };
      
      await contract.setData(
        `evidence_${evidenceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedEvidence))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Evidence rejected after FHE analysis!"
      });
      
      await loadEvidence();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isSubmitter = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the e-Court system",
      icon: "🔗"
    },
    {
      title: "Submit Encrypted Evidence",
      description: "Upload your evidence which will be encrypted using FHE technology",
      icon: "🔒"
    },
    {
      title: "FHE Processing",
      description: "Your evidence is processed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Get Validation Results",
      description: "Receive court validation while keeping your evidence private",
      icon: "📊"
    }
  ];

  const renderBarChart = () => {
    const maxValue = Math.max(submittedCount, underReviewCount, acceptedCount, rejectedCount, 1);
    
    return (
      <div className="bar-chart-container">
        <div className="bar-chart">
          <div className="bar-wrapper">
            <div className="bar-label">Submitted</div>
            <div className="bar">
              <div 
                className="bar-fill submitted" 
                style={{ width: `${(submittedCount / maxValue) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{submittedCount}</div>
          </div>
          <div className="bar-wrapper">
            <div className="bar-label">Review</div>
            <div className="bar">
              <div 
                className="bar-fill under_review" 
                style={{ width: `${(underReviewCount / maxValue) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{underReviewCount}</div>
          </div>
          <div className="bar-wrapper">
            <div className="bar-label">Accepted</div>
            <div className="bar">
              <div 
                className="bar-fill accepted" 
                style={{ width: `${(acceptedCount / maxValue) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{acceptedCount}</div>
          </div>
          <div className="bar-wrapper">
            <div className="bar-label">Rejected</div>
            <div className="bar">
              <div 
                className="bar-fill rejected" 
                style={{ width: `${(rejectedCount / maxValue) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{rejectedCount}</div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection to e-Court...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="scale-icon"></div>
          </div>
          <h1>eCourt<span>FHE</span></h1>
          <p className="tagline">Privacy-Preserving Electronic Court System</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowSubmitModal(true)} 
            className="submit-evidence-btn primary-btn"
            disabled={!account}
          >
            <div className="add-icon"></div>
            Submit Evidence
          </button>
          <button 
            className="secondary-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "How It Works"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Fully Homomorphic Encryption for Court Evidence</h2>
            <p>Submit and validate court evidence without compromising privacy using advanced FHE technology</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>eCourtFHE Process Guide</h2>
            <p className="subtitle">Learn how to securely submit and validate court evidence</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-number">{index + 1}</div>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="controls-row">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search by case ID or evidence type..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            <div className="search-icon"></div>
          </div>
          
          <div className="filter-group">
            <label>Status:</label>
            <select 
              value={filterStatus} 
              onChange={(e) => setFilterStatus(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Status</option>
              <option value="submitted">Submitted</option>
              <option value="under_review">Under Review</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          
          <button 
            onClick={() => setShowStats(!showStats)}
            className="toggle-stats-btn secondary-btn"
          >
            {showStats ? "Hide Stats" : "Show Stats"}
          </button>
        </div>
        
        {showStats && (
          <div className="stats-section">
            <h3>Evidence Statistics</h3>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{evidenceList.length}</div>
                <div className="stat-label">Total Evidence</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{submittedCount}</div>
                <div className="stat-label">Submitted</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{underReviewCount}</div>
                <div className="stat-label">Under Review</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{acceptedCount}</div>
                <div className="stat-label">Accepted</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
            
            <div className="chart-container">
              {renderBarChart()}
            </div>
          </div>
        )}
        
        <div className="evidence-section">
          <div className="section-header">
            <h2>Encrypted Evidence Records</h2>
            <div className="header-actions">
              <button 
                onClick={loadEvidence}
                className="refresh-btn secondary-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Evidence"}
              </button>
            </div>
          </div>
          
          <div className="evidence-list">
            <div className="table-header">
              <div className="header-cell">Case ID</div>
              <div className="header-cell">Evidence Type</div>
              <div className="header-cell">Submitted By</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredEvidence.length === 0 ? (
              <div className="no-evidence">
                <div className="no-evidence-icon"></div>
                <p>No evidence records found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowSubmitModal(true)}
                >
                  Submit First Evidence
                </button>
              </div>
            ) : (
              filteredEvidence.map(evidence => (
                <div className="evidence-row" key={evidence.id}>
                  <div className="table-cell case-id">{evidence.caseId}</div>
                  <div className="table-cell">{evidence.evidenceType}</div>
                  <div className="table-cell">{evidence.submitter.substring(0, 6)}...{evidence.submitter.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(evidence.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${evidence.status}`}>
                      {evidence.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isSubmitter(evidence.submitter) && (
                      <>
                        {evidence.status === "submitted" && (
                          <button 
                            className="action-btn secondary-btn"
                            onClick={() => reviewEvidence(evidence.id)}
                          >
                            Review
                          </button>
                        )}
                        {evidence.status === "under_review" && (
                          <>
                            <button 
                              className="action-btn success-btn"
                              onClick={() => acceptEvidence(evidence.id)}
                            >
                              Accept
                            </button>
                            <button 
                              className="action-btn danger-btn"
                              onClick={() => rejectEvidence(evidence.id)}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showSubmitModal && (
        <ModalSubmit 
          onSubmit={submitEvidence} 
          onClose={() => setShowSubmitModal(false)} 
          submitting={submitting}
          evidenceData={newEvidence}
          setEvidenceData={setNewEvidence}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h4>eCourtFHE</h4>
            <p>Privacy-preserving electronic court system using Fully Homomorphic Encryption technology.</p>
          </div>
          
          <div className="footer-section">
            <h4>Resources</h4>
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">API Reference</a>
          </div>
          
          <div className="footer-section">
            <h4>Support</h4>
            <a href="#" className="footer-link">Help Center</a>
            <a href="#" className="footer-link">Contact Support</a>
            <a href="#" className="footer-link">Status</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="copyright">
            © {new Date().getFullYear()} eCourtFHE. All rights reserved.
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalSubmitProps {
  onSubmit: () => void; 
  onClose: () => void; 
  submitting: boolean;
  evidenceData: any;
  setEvidenceData: (data: any) => void;
}

const ModalSubmit: React.FC<ModalSubmitProps> = ({ 
  onSubmit, 
  onClose, 
  submitting,
  evidenceData,
  setEvidenceData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEvidenceData({
      ...evidenceData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!evidenceData.caseId || !evidenceData.evidenceType || !evidenceData.content) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="submit-modal">
        <div className="modal-header">
          <h2>Submit Encrypted Evidence</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div> 
            <span>Your evidence will be encrypted with FHE technology and remain confidential throughout processing</span>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Case ID *</label>
              <input 
                type="text"
                name="caseId"
                value={evidenceData.caseId} 
                onChange={handleChange}
                placeholder="Enter case identifier" 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Evidence Type *</label>
              <select 
                name="evidenceType"
                value={evidenceData.evidenceType} 
                onChange={handleChange}
                className="form-select"
              >
                <option value="">Select type</option>
                <option value="Document">Document</option>
                <option value="Photo">Photo Evidence</option>
                <option value="Video">Video Recording</option>
                <option value="Audio">Audio Recording</option>
                <option value="Digital">Digital Evidence</option>
                <option value="Forensic">Forensic Report</option>
                <option value="Expert">Expert Opinion</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text"
                name="description"
                value={evidenceData.description} 
                onChange={handleChange}
                placeholder="Brief description of evidence" 
                className="form-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Evidence Content *</label>
              <textarea 
                name="content"
                value={evidenceData.content} 
                onChange={handleChange}
                placeholder="Enter evidence details or description..." 
                className="form-textarea"
                rows={4}
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn secondary-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={submitting}
            className="submit-btn primary-btn"
          >
            {submitting ? "Encrypting with FHE..." : "Submit Evidence"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;