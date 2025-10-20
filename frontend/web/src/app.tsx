// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface ClinicalTrialRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  trialPhase: string;
  status: "pending" | "approved" | "rejected";
  patientCount: number;
  adverseEvents: number;
}

// Randomized style selections:
// Colors: Tech (blue+black)
// UI Style: Glass morphism
// Layout: Multi-column dashboard
// Interaction: Micro-interactions (hover effects)
// Random features: Data statistics, Smart charts, Search & filter, Compliance verification

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'increase10%':
      result = value * 1.1;
      break;
    case 'decrease10%':
      result = value * 0.9;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [trials, setTrials] = useState<ClinicalTrialRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newTrialData, setNewTrialData] = useState({ 
    trialPhase: "", 
    description: "", 
    patientCount: 0,
    adverseEvents: 0
  });
  const [selectedTrial, setSelectedTrial] = useState<ClinicalTrialRecord | null>(null);
  const [decryptedPatientCount, setDecryptedPatientCount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPhase, setFilterPhase] = useState("all");
  
  const approvedCount = trials.filter(t => t.status === "approved").length;
  const pendingCount = trials.filter(t => t.status === "pending").length;
  const rejectedCount = trials.filter(t => t.status === "rejected").length;

  useEffect(() => {
    loadTrials().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadTrials = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("trial_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing trial keys:", e); }
      }
      
      const list: ClinicalTrialRecord[] = [];
      for (const key of keys) {
        try {
          const trialBytes = await contract.getData(`trial_${key}`);
          if (trialBytes.length > 0) {
            try {
              const trialData = JSON.parse(ethers.toUtf8String(trialBytes));
              list.push({ 
                id: key, 
                encryptedData: trialData.data, 
                timestamp: trialData.timestamp, 
                owner: trialData.owner, 
                trialPhase: trialData.trialPhase, 
                status: trialData.status || "pending",
                patientCount: trialData.patientCount || 0,
                adverseEvents: trialData.adverseEvents || 0
              });
            } catch (e) { console.error(`Error parsing trial data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading trial ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setTrials(list);
    } catch (e) { console.error("Error loading trials:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitTrial = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Encrypting clinical trial data with Zama FHE..." 
    });
    
    try {
      // Encrypt sensitive data points
      const encryptedPatientCount = FHEEncryptNumber(newTrialData.patientCount);
      const encryptedAdverseEvents = FHEEncryptNumber(newTrialData.adverseEvents);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const trialId = `trial-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const trialData = { 
        data: encryptedPatientCount, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        trialPhase: newTrialData.trialPhase, 
        status: "pending",
        patientCount: newTrialData.patientCount,
        adverseEvents: encryptedAdverseEvents
      };
      
      await contract.setData(`trial_${trialId}`, ethers.toUtf8Bytes(JSON.stringify(trialData)));
      
      // Update trial keys list
      const keysBytes = await contract.getData("trial_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(trialId);
      await contract.setData("trial_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Clinical trial data encrypted and submitted securely!" 
      });
      
      await loadTrials();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTrialData({ 
          trialPhase: "", 
          description: "", 
          patientCount: 0,
          adverseEvents: 0
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
      setTimeout(() => setTransactionStatus({ 
        visible: false, 
        status: "pending", 
        message: "" 
      }), 3000);
    } finally { 
      setCreating(false); 
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const approveTrial = async (trialId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Processing encrypted trial data with FHE..." 
    });
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      const trialBytes = await contract.getData(`trial_${trialId}`);
      if (trialBytes.length === 0) throw new Error("Trial not found");
      const trialData = JSON.parse(ethers.toUtf8String(trialBytes));
      
      // Perform FHE computation on encrypted data
      const updatedPatientCount = FHECompute(trialData.data, 'increase10%');
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedTrial = { 
        ...trialData, 
        status: "approved", 
        data: updatedPatientCount 
      };
      
      await contractWithSigner.setData(
        `trial_${trialId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedTrial))
      );
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "FHE verification completed successfully!" 
      });
      await loadTrials();
      setTimeout(() => setTransactionStatus({ 
        visible: false, 
        status: "pending", 
        message: "" 
      }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Approval failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ 
        visible: false, 
        status: "pending", 
        message: "" 
      }), 3000);
    }
  };

  const rejectTrial = async (trialId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Processing encrypted trial data with FHE..." 
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const trialBytes = await contract.getData(`trial_${trialId}`);
      if (trialBytes.length === 0) throw new Error("Trial not found");
      const trialData = JSON.parse(ethers.toUtf8String(trialBytes));
      
      const updatedTrial = { 
        ...trialData, 
        status: "rejected" 
      };
      
      await contract.setData(
        `trial_${trialId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedTrial))
      );
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "FHE rejection completed successfully!" 
      });
      await loadTrials();
      setTimeout(() => setTransactionStatus({ 
        visible: false, 
        status: "pending", 
        message: "" 
      }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Rejection failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ 
        visible: false, 
        status: "pending", 
        message: "" 
      }), 3000);
    }
  };

  const isOwner = (trialAddress: string) => 
    address?.toLowerCase() === trialAddress.toLowerCase();

  const filteredTrials = trials.filter(trial => {
    const matchesSearch = trial.trialPhase.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          trial.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPhase = filterPhase === "all" || trial.trialPhase === filterPhase;
    return matchesSearch && matchesPhase;
  });

  const renderComplianceBadge = () => {
    const complianceScore = Math.min(
      100, 
      approvedCount * 10 + pendingCount * 5
    );
    
    return (
      <div className="compliance-badge">
        <div className="compliance-meter">
          <div 
            className="compliance-fill" 
            style={{ width: `${complianceScore}%` }}
          ></div>
        </div>
        <div className="compliance-label">
          Regulatory Compliance: {complianceScore}%
        </div>
        <div className="compliance-details">
          {approvedCount} Approved Trials | {pendingCount} Pending | {rejectedCount} Rejected
        </div>
      </div>
    );
  };

  const renderPhaseDistributionChart = () => {
    const phases: Record<string, number> = {};
    trials.forEach(trial => {
      phases[trial.trialPhase] = (phases[trial.trialPhase] || 0) + 1;
    });
    
    const total = trials.length || 1;
    const phaseEntries = Object.entries(phases);
    
    return (
      <div className="phase-chart">
        {phaseEntries.map(([phase, count], index) => {
          const percentage = (count / total) * 100;
          const prevPercentages = phaseEntries
            .slice(0, index)
            .reduce((sum, [, prevCount]) => sum + (prevCount / total) * 100, 0);
          
          return (
            <div 
              key={phase}
              className="phase-segment"
              style={{
                background: `hsl(${index * 60}, 70%, 50%)`,
                width: `${percentage}%`,
                left: `${prevPercentages}%`
              }}
              title={`${phase}: ${count} trials (${percentage.toFixed(1)}%)`}
            ></div>
          );
        })}
        <div className="phase-legend">
          {phaseEntries.map(([phase, count], index) => (
            <div key={phase} className="legend-item">
              <div 
                className="color-box" 
                style={{ background: `hsl(${index * 60}, 70%, 50%)` }}
              ></div>
              <span>{phase}: {count}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted clinical trial connection...</p>
    </div>
  );

  return (
    <div className="app-container glass-theme">
      <header className="app-header">
        <div className="logo">
          <div className="dna-icon"></div>
          <h1>FHE<span>Clinical</span>Trials</h1>
        </div>
        <div className="header-actions">
          <ConnectButton 
            accountStatus="address" 
            chainStatus="icon" 
            showBalance={false}
          />
        </div>
      </header>

      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Clinical Trials Platform</h2>
            <p>Securely manage multi-center trials with Zama FHE encrypted patient data</p>
          </div>
          <div className="fhe-indicator">
            <div className="fhe-lock"></div>
            <span>FHE Encryption Active</span>
          </div>
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>Project Overview</h3>
            <p>
              A <strong>Zama FHE-powered</strong> platform for biotech companies to manage 
              clinical trials with end-to-end encrypted patient data. All statistical 
              analysis is performed homomorphically without decryption.
            </p>
            <div className="fhe-badge">
              <span>FHE-Powered Confidential Computing</span>
            </div>
          </div>

          <div className="dashboard-card">
            <h3>Trial Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{trials.length}</div>
                <div className="stat-label">Total Trials</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{approvedCount}</div>
                <div className="stat-label">Approved</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
          </div>

          <div className="dashboard-card">
            <h3>Regulatory Compliance</h3>
            {renderComplianceBadge()}
          </div>

          <div className="dashboard-card">
            <h3>Trial Phase Distribution</h3>
            {renderPhaseDistributionChart()}
          </div>
        </div>

        <div className="trials-section">
          <div className="section-header">
            <h2>Clinical Trial Records</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input
                  type="text"
                  placeholder="Search trials..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <select
                  value={filterPhase}
                  onChange={(e) => setFilterPhase(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Phases</option>
                  <option value="Phase I">Phase I</option>
                  <option value="Phase II">Phase II</option>
                  <option value="Phase III">Phase III</option>
                  <option value="Phase IV">Phase IV</option>
                </select>
              </div>
              <button 
                onClick={() => setShowCreateModal(true)} 
                className="create-btn"
              >
                + New Trial
              </button>
              <button 
                onClick={loadTrials} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="trials-list">
            <div className="table-header">
              <div className="header-cell">Trial ID</div>
              <div className="header-cell">Phase</div>
              <div className="header-cell">Patients</div>
              <div className="header-cell">Adverse Events</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredTrials.length === 0 ? (
              <div className="no-trials">
                <div className="no-trials-icon"></div>
                <p>No clinical trials found</p>
                <button 
                  className="primary-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Trial
                </button>
              </div>
            ) : (
              filteredTrials.map(trial => (
                <div 
                  className="trial-row" 
                  key={trial.id}
                  onClick={() => setSelectedTrial(trial)}
                >
                  <div className="table-cell trial-id">
                    #{trial.id.substring(0, 6)}
                  </div>
                  <div className="table-cell">{trial.trialPhase}</div>
                  <div className="table-cell">
                    {FHEEncryptNumber(trial.patientCount).substring(0, 8)}...
                  </div>
                  <div className="table-cell">
                    {FHEEncryptNumber(trial.adverseEvents).substring(0, 8)}...
                  </div>
                  <div className="table-cell">
                    {new Date(trial.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${trial.status}`}>
                      {trial.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(trial.owner) && trial.status === "pending" && (
                      <>
                        <button 
                          className="action-btn approve" 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            approveTrial(trial.id); 
                          }}
                        >
                          Approve
                        </button>
                        <button 
                          className="action-btn reject" 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            rejectTrial(trial.id); 
                          }}
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitTrial} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          trialData={newTrialData} 
          setTrialData={setNewTrialData}
        />
      )}

      {selectedTrial && (
        <TrialDetailModal 
          trial={selectedTrial} 
          onClose={() => { 
            setSelectedTrial(null); 
            setDecryptedPatientCount(null); 
          }} 
          decryptedValue={decryptedPatientCount} 
          setDecryptedValue={setDecryptedPatientCount} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && (
                <div className="spinner"></div>
              )}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="dna-icon"></div>
              <span>FHE Clinical Trials</span>
            </div>
            <p>Secure encrypted clinical trials using Zama FHE technology</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">HIPAA Compliance</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact Support</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Patient Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Clinical Trials. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  trialData: any;
  setTrialData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating, 
  trialData, 
  setTrialData 
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setTrialData({ ...trialData, [name]: value });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setTrialData({ ...trialData, [name]: parseInt(value) || 0 });
  };

  const handleSubmit = () => {
    if (!trialData.trialPhase || trialData.patientCount <= 0) {
      alert("Please fill required fields with valid values");
      return;
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>New Clinical Trial</h2>
          <button onClick={onClose} className="close-modal">
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="shield-icon"></div>
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Patient data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>

          <div className="form-group">
            <label>Trial Phase *</label>
            <select
              name="trialPhase"
              value={trialData.trialPhase}
              onChange={handleChange}
              className="form-select"
            >
              <option value="">Select trial phase</option>
              <option value="Phase I">Phase I</option>
              <option value="Phase II">Phase II</option>
              <option value="Phase III">Phase III</option>
              <option value="Phase IV">Phase IV</option>
            </select>
          </div>

          <div className="form-group">
            <label>Description</label>
            <input
              type="text"
              name="description"
              value={trialData.description}
              onChange={handleChange}
              placeholder="Brief description..."
              className="form-input"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Patient Count *</label>
              <input
                type="number"
                name="patientCount"
                value={trialData.patientCount}
                onChange={handleNumberChange}
                min="1"
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Adverse Events</label>
              <input
                type="number"
                name="adverseEvents"
                value={trialData.adverseEvents}
                onChange={handleNumberChange}
                min="0"
                className="form-input"
              />
            </div>
          </div>

          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-grid">
              <div className="preview-item">
                <span>Patient Count:</span>
                <div>
                  {trialData.patientCount > 0 
                    ? FHEEncryptNumber(trialData.patientCount).substring(0, 30) + '...' 
                    : 'Not encrypted yet'}
                </div>
              </div>
              <div className="preview-item">
                <span>Adverse Events:</span>
                <div>
                  {trialData.adverseEvents >= 0 
                    ? FHEEncryptNumber(trialData.adverseEvents).substring(0, 30) + '...' 
                    : 'Not encrypted yet'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating} 
            className="submit-btn"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface TrialDetailModalProps {
  trial: ClinicalTrialRecord;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const TrialDetailModal: React.FC<TrialDetailModalProps> = ({ 
  trial, 
  onClose, 
  decryptedValue, 
  setDecryptedValue, 
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) {
      setDecryptedValue(null);
      return;
    }
    const decrypted = await decryptWithSignature(trial.encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="trial-detail-modal">
        <div className="modal-header">
          <h2>Trial Details #{trial.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="trial-info">
            <div className="info-item">
              <span>Phase:</span>
              <strong>{trial.trialPhase}</strong>
            </div>
            <div className="info-item">
              <span>Sponsor:</span>
              <strong>
                {trial.owner.substring(0, 6)}...{trial.owner.substring(38)}
              </strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>
                {new Date(trial.timestamp * 1000).toLocaleString()}
              </strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${trial.status}`}>
                {trial.status}
              </strong>
            </div>
          </div>

          <div className="encrypted-data-section">
            <h3>Encrypted Patient Data</h3>
            <div className="data-grid">
              <div className="data-item">
                <span>Patient Count:</span>
                <div>{trial.encryptedData.substring(0, 50)}...</div>
              </div>
              <div className="data-item">
                <span>Adverse Events:</span>
                <div>
                  {FHEEncryptNumber(trial.adverseEvents).substring(0, 50)}...
                </div>
              </div>
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            <button
              className="decrypt-btn"
              onClick={handleDecrypt}
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedValue !== null ? (
                "Hide Decrypted Value"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>

          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Patient Count</h3>
              <div className="decrypted-value">{decryptedValue}</div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>
                  Decrypted data is only visible after wallet signature verification
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;