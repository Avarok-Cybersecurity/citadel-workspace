import React, { useEffect, useRef, useState } from "react";
import "./registration.css";
import Modal from "react-modal";
import Select from "react-select";
import { kemOptions, secrecyOptions, securityLevels, encryptionOptions, sigOptions, RegistrationRequest, register } from "../../../api/registration";
import { invoke } from "@tauri-apps/api/core";
import { ListKnownServersRequest, ListKnownServersResponse } from "../../../api/types";
import { redirect, useNavigate } from "react-router-dom";

// Styles to pass to modal
const customStyles = {
  content: {
    top: "50%",
    left: "50%",
    right: "auto",
    bottom: "auto",
    marginRight: "-50%",
    transform: "translate(-50%, -50%)",
    padding: "0",
    border: "none",
  },
};

// bind modal to root (https://reactcommunity.org/react-modal/accessibility/)
Modal.setAppElement("#root");



function Step1(props: { onNext: () => void, onBack: () => void, registrationRequest: RegistrationRequest }) {


  const [workspaceIdentifier, setWorkspaceIdentifier] = useState<string>(props.registrationRequest.workspaceIdentifier || "127.0.0.1:12349") // Address for debugging
  const [workspacePassword, setWorkspacePassword] = useState<string>(props.registrationRequest.workspacePassword || "")

  return <>
    <h2>Workspace Information</h2>

    <h3>Workspace Identifier</h3>
    <div className="input-icon-pair">
      <input type="text" placeholder="workspace-name.avarok.net" value={workspaceIdentifier} onChange={(ev) => { setWorkspaceIdentifier(ev.target.value) }} />
      <i className="bi bi-question-circle"></i>
    </div>

    <h3>Workspace Password</h3>
    <div className="input-icon-pair">
      <input type="password" value={workspacePassword} onChange={(ev) => { setWorkspacePassword(ev.target.value) }} />
      <i className="bi bi-question-circle"></i>
    </div>

    <div className="bottom-buttons">
      <button id="cancel-btn" onClick={props.onBack}>
        Cancel
      </button>
      <button
        id="next-btn"
        onClick={() => {


          if (workspaceIdentifier.trim() === "") {
            // TODO @kyle-tennison: We'll have a proper alert system in the future
            console.error("Workspace Identifier cannot be empty.")
            return;
          }


          props.registrationRequest.workspaceIdentifier = workspaceIdentifier;
          props.registrationRequest.workspacePassword = workspacePassword;
          props.onNext()


        }}

      >
        Next
      </button>
    </div>
  </>
}

function Step2(props: { onNext: () => void, onBack: () => void, registrationRequest: RegistrationRequest }) {
  const [advancedMode, setAdvancedMode] = useState(false);

  const [securityLevel, setSecurityLevel] = useState<number>(props.registrationRequest.securityLevel || 0);
  const [securityMode, setSecurityMode] = useState<number>(props.registrationRequest.securityMode || 0);
  const [encryptionAlgorithm, setEncryptionAlgorithm] = useState<number>(props.registrationRequest.encryptionAlgorithm || 0);
  const [kemAlgorithm, setKemAlgorithm] = useState<number>(props.registrationRequest.kemAlgorithm || 0);
  const [sigAlgorithm, setSigAlgorithm] = useState<number>(props.registrationRequest.sigAlgorithm || 0);

  return <>
    <h2>Session Security Settings</h2>
    <h3>Security Level</h3>
    <div className="input-icon-pair">
      <Select
        className="select"
        options={securityLevels}
        value={securityLevels.find(option => option.value === securityLevel)}
        onChange={(ev) => { setSecurityLevel(ev?.value || securityLevel) }}
        unstyled
      />
      <i className="bi bi-question-circle"></i>
    </div>

    <h3>Security Mode</h3>
    <div className="input-icon-pair">
      <Select
        className="select"
        options={secrecyOptions}
        value={secrecyOptions.find(option => option.value === securityMode)}
        onChange={(ev) => { setSecurityMode(ev?.value || securityMode) }}
        unstyled
      />
      <i className="bi bi-question-circle"></i>
    </div>

    <div className="advanced-settings-header">
      <h2>Advanced Settings</h2>
      <button onClick={() => { setAdvancedMode(current => !current) }} style={{ transform: advancedMode ? "rotate(180deg)" : "rotate(0deg)" }}>
        <i className="bi bi-chevron-down"></i>
      </button>
    </div>

    <div className="advanced-settings" style={{ display: advancedMode ? "block" : "none" }}>
      <h3>Encryption Algorithm</h3>
      <div className="input-icon-pair">
        <Select
          className="select"
          options={encryptionOptions}
          value={encryptionOptions.find(option => option.value === encryptionAlgorithm)}
          onChange={(ev) => { setEncryptionAlgorithm(ev?.value || encryptionAlgorithm) }}
          unstyled
        />
        <i className="bi bi-question-circle"></i>
      </div>

      <h3>KEM Algorithm</h3>
      <div className="input-icon-pair">
        <Select
          className="select"
          options={kemOptions}
          value={kemOptions.find(option => option.value === kemAlgorithm)}
          onChange={(ev) => { setKemAlgorithm(ev?.value || kemAlgorithm) }}
          unstyled
        />
        <i className="bi bi-question-circle"></i>
      </div>

      <h3>SIG Algorithm</h3>
      <div className="input-icon-pair">
        <Select
          className="select"
          options={sigOptions}
          value={sigOptions.find(option => option.value === sigAlgorithm)}
          onChange={(ev) => { setSigAlgorithm(ev?.value || sigAlgorithm) }}
          unstyled
        />
        <i className="bi bi-question-circle"></i>
      </div>
    </div>

    <div className="bottom-buttons">
      <button
        id="cancel-btn"
        onClick={props.onBack}
      >
        Back
      </button>
      <button
        id="next-btn"
        onClick={() => {
          props.registrationRequest.securityLevel = securityLevel
          props.registrationRequest.securityMode = securityMode
          props.registrationRequest.encryptionAlgorithm = encryptionAlgorithm
          props.registrationRequest.kemAlgorithm = kemAlgorithm
          props.registrationRequest.sigAlgorithm = sigAlgorithm
          console.log(props.registrationRequest)
          props.onNext()
        }}
      >
        Next
      </button>
    </div>
  </>
}

function Step3(props: { onNext: () => void, onBack: () => void, registrationRequest: RegistrationRequest }) {

  const [fullName, setFullName] = useState<string>(props.registrationRequest.fullName || "");
  const [username, setUsername] = useState<string>(props.registrationRequest.username || "");
  const [profilePassword, setProfilePassword] = useState<string>(props.registrationRequest.profilePassword || "");
  const [profilePasswordConfirmation, setProfilePasswordConfirmation] = useState<string>(props.registrationRequest.profilePassword || "");


  return <>
    <h2>Server Profile</h2>

    <h3>Full Name</h3>
    <div className="input-icon-pair">
      <input type="text" placeholder="John Doe" value={fullName} onChange={(ev) => { setFullName(ev.target.value) }} />
      <i className="bi bi-question-circle"></i>
    </div>

    <h3>Username</h3>
    <div className="input-icon-pair">
      <input type="text" placeholder="jdoe332" value={username} onChange={(ev) => { setUsername(ev.target.value) }} />
      <i className="bi bi-question-circle"></i>
    </div>

    <h3>Profile Password</h3>
    <div className="input-icon-pair">
      <input type="password" value={profilePassword} onChange={(ev) => { setProfilePassword(ev.target.value) }} />
      <i className="bi bi-question-circle"></i>
    </div>

    <h3>Confirm Profile Password</h3>
    <div className="input-icon-pair">
      <input type="password" value={profilePasswordConfirmation} onChange={(ev) => { setProfilePasswordConfirmation(ev.target.value) }} 
      onClick={() => { if (profilePasswordConfirmation !== profilePassword) { setProfilePasswordConfirmation("") } }} />
      <i className="bi bi-question-circle"></i>
    </div>

    <div className="bottom-buttons">
      <button id="cancel-btn" onClick={props.onBack}>
        Back
      </button>
      <button
        id="next-btn"
        onClick={() => {

            if (profilePassword !== profilePasswordConfirmation){
              console.error("Passwords don't match")
              return;
            }

            if (fullName.trim() === ""){
              console.error("Full name cannot be empty");
              return;
            }

            if (username.trim() === ""){
              console.error("Username cannot be empty");
              return;
            }

            if (profilePassword.trim() === ""){
              console.error("Password cannot be empty")
              return;
            }

            if (username.length < 3 || username.length > 37){
              console.error("Username must be between 3 and 37 characters");
              return;
            }

            if (fullName.length < 2 || fullName.length > 77){
              console.error("Full name must be between 2 and 77 characters");
              return;
            }

            props.registrationRequest.fullName = fullName
            props.registrationRequest.username = username
            props.registrationRequest.profilePassword = profilePassword

            console.log(props.registrationRequest)

            props.onNext()
        }}
      >
        Next
      </button>
    </div>
  </>
}

function Step4(props: { onNext: () => void, onBack: () => void, registrationRequest: RegistrationRequest }) {

  const [success, setSuccess] = useState<boolean|null>(null);
  const [message, setMessage] = useState<string>("");
  const navigate = useNavigate();


  useEffect(()=>{

    const inner = async () => {
      const response = await register(props.registrationRequest);
      setSuccess(response?.success||null)
      const message = (response?.success ? "Success: " : "Error: ") + (response?.message||"Unknown");
      setMessage(message)
      console.log("redirecting to /home")
      return navigate("/home")
    }

    inner()

  }, [])

  return <>
  <h2>Registering to server</h2>
  <h3>Please wait...</h3>

  <p className="console" style={{color: success ? "white" : "#f1707c"}}>{message}</p>

  <div className="bottom-buttons">
      <button id="cancel-btn" onClick={props.onBack}>
        Cancel
      </button>
    </div>
  </>
}


export default function RegistrationPopup(props: {
  isOpen: boolean;
  setIsOpen: (state: boolean) => void;
}) {
  const [currentPage, setCurrentPage] = useState<JSX.Element>(<></>);
  const pageName = useRef<string | null>(null)


  // Empty registration request to fill
  var registrationRequest: RegistrationRequest = {
    workspaceIdentifier: null,
    workspacePassword: null,
    securityLevel: null,
    securityMode: null,
    encryptionAlgorithm: null,
    kemAlgorithm: null,
    sigAlgorithm: null,
    fullName: null,
    username: null,
    profilePassword: null,
  }


  function onBack() {
    switch (pageName.current) {
      case "step1":
        closeModal()
        break;
      case "step2":
        pageName.current = "step1"
        setCurrentPage(<Step1 onNext={onNext} onBack={onBack} registrationRequest={registrationRequest} />);
        break;
      case "step3":
        pageName.current = "step2"
        setCurrentPage(<Step2 onNext={onNext} onBack={onBack} registrationRequest={registrationRequest} />);
        break;
      case "step4":
        pageName.current = "step3"
        setCurrentPage(<Step3 onNext={onNext} onBack={onBack} registrationRequest={registrationRequest} />);
        break;
      default:
        break;
    }
  }
  function onNext() {
    switch (pageName.current) {
      case "step1":
        pageName.current = "step2"
        setCurrentPage(<Step2 onNext={onNext} onBack={onBack} registrationRequest={registrationRequest} />);
        break;
      case "step2":
        pageName.current = "step3"
        setCurrentPage(<Step3 onNext={onNext} onBack={onBack} registrationRequest={registrationRequest} />);
        break;
      case "step3":
        pageName.current = "step4"
        setCurrentPage(<Step4 onNext={onNext} onBack={onBack} registrationRequest={registrationRequest} />);
        break;
      default:
        break;
    }
  }

  function openModal() {
    props.setIsOpen(true);
  }

  function afterOpenModal() {
    pageName.current = "step1"
    setCurrentPage(<Step1 onNext={onNext} onBack={onBack} registrationRequest={registrationRequest} />);
  }

  function closeModal() {
    props.setIsOpen(false);
  }

  useEffect(() => {
    pageName.current = "step1"
    setCurrentPage(<Step1 onNext={onNext} onBack={onBack} registrationRequest={registrationRequest} />);
  }, [])

  return (
    <div>
      <Modal
        isOpen={props.isOpen}
        onAfterOpen={afterOpenModal}
        onRequestClose={closeModal}
        style={customStyles}
        contentLabel="Example Modal"
      >
        <div id="registration-content">
          <div className="header">
            <i className="bi bi-shield-plus"></i>
            <h1>Add a new Workspace</h1>
          </div>
          {currentPage}
        </div>
      </Modal>
    </div>
  );
}
