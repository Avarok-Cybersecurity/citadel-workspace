import React, { useEffect, useRef, useState } from "react";
import "./registration.css";
import Modal from "react-modal";
import Select from "react-select";




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

// Make sure to bind modal to your appElement (https://reactcommunity.org/react-modal/accessibility/)
Modal.setAppElement("#root");

const secrecyOptions = [
  { label: "Best Effort", value: 1 },
  { label: "Perfect Forward Secrecy", value: 2 },
];
const securityLevels = [
  { label: "Standard", value: 0 },
  { label: "Reinforced", value: 127 },
  { label: "High", value: 255 },
];
const sigOptions = [
  { label: "None", value: 0 },
  { label: "Falcon1024", value: 1 },
];
const encryptionOptions = [
  { label: "AES_GCM_256", value: 0 },
  { label: "ChaCha20Poly_1305", value: 1 },
  { label: "Kyber", value: 2 },
  { label: "Ascon80pq", value: 3 },
];
const kemOptions = [
  { label: "Kyber", value: 0 },
  { label: "Ntru", value: 1 },
];

function Step1(props: {onNext: ()=>void, onBack: ()=>void}){
  return <>
  <h2>Workspace Information</h2>

  <h3>Workspace Identifier</h3>
  <div className="input-icon-pair">
    <input type="text" placeholder="workspace-name.avarok.net" />
    <i className="bi bi-question-circle"></i>
  </div>

  <h3>Workspace Password</h3>
  <div className="input-icon-pair">
    <input type="password" />
    <i className="bi bi-question-circle"></i>
  </div>

  <div className="bottom-buttons">
    <button id="cancel-btn" onClick={props.onBack}>
      Cancel
    </button>
    <button
      id="next-btn"
      onClick={props.onNext}
    >
      Next
    </button>
  </div>
</>
}

function Step2(props: {onNext: ()=>void, onBack: ()=>void}){
  const [advancedMode, setAdvancedMode] = useState(false);

  return <>
  <h2>Session Security Settings</h2>
    <h3>Security Level</h3>
    <div className="input-icon-pair">
      <Select
        className="select"
        options={securityLevels}
        defaultValue={securityLevels[0]}
        unstyled
      />
      <i className="bi bi-question-circle"></i>
    </div>

    <h3>Security Mode</h3>
    <div className="input-icon-pair">
      <Select
        className="select"
        options={secrecyOptions}
        defaultValue={secrecyOptions[0]}
        unstyled
      />
      <i className="bi bi-question-circle"></i>
    </div>

    <div className="advanced-settings-header">
      <h2>Advanced Settings</h2>
      <button onClick={() => {setAdvancedMode(current => !current)}} style={{transform: advancedMode ? "rotate(180deg)" : "rotate(0deg)"}}>
        <i className="bi bi-chevron-down"></i>
      </button>
    </div>

    <div className="advanced-settings" style={{ display: advancedMode ? "block" : "none" }}>
      <h3>Encryption Algorithm</h3>
      <div className="input-icon-pair">
        <Select
          className="select"
          options={encryptionOptions}
          defaultValue={encryptionOptions[0]}
          unstyled
        />
        <i className="bi bi-question-circle"></i>
      </div>

      <h3>KEM Algorithm</h3>
      <div className="input-icon-pair">
        <Select
          className="select"
          options={kemOptions}
          defaultValue={kemOptions[0]}
          unstyled
        />
        <i className="bi bi-question-circle"></i>
      </div>

      <h3>SIG Algorithm</h3>
      <div className="input-icon-pair">
        <Select
          className="select"
          options={sigOptions}
          defaultValue={sigOptions[0]}
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
        onClick={props.onNext}
      >
        Next
      </button>
    </div>
  </>
}

function Step3(props: {onNext: ()=>void, onBack: ()=>void}){
  return <>
  <h2>Server Profile</h2>

  <h3>Full Name</h3>
  <div className="input-icon-pair">
    <input type="text" placeholder="John Doe" />
    <i className="bi bi-question-circle"></i>
  </div>

  <h3>Username</h3>
  <div className="input-icon-pair">
    <input type="text" placeholder="jdoe332" />
    <i className="bi bi-question-circle"></i>
  </div>

  <h3>Profile Password</h3>
  <div className="input-icon-pair">
    <input type="password" />
    <i className="bi bi-question-circle"></i>
  </div>

  <h3>Confirm Profile Password</h3>
  <div className="input-icon-pair">
    <input type="password" />
    <i className="bi bi-question-circle"></i>
  </div>

  <div className="bottom-buttons">
    <button id="cancel-btn" onClick={props.onBack}>
      Back
    </button>
    <button
      id="next-btn"
      onClick={props.onNext}
    >
      Next
    </button>
  </div>
</>
}


export default function RegistrationPopup(props: {
  isOpen: boolean;
  setIsOpen: (state: boolean) => void;
}) {
  const [currentPage, setCurrentPage] = useState<JSX.Element>(<></>);
  const pageName = useRef<string|null>(null)


  function onBack(){
    console.log(`onBack: page: ${pageName.current}`)
    switch (pageName.current){
      case "step1":
        closeModal()
        break;
      case "step2":
        pageName.current = "step1"
        setCurrentPage(<Step1 onNext={onNext} onBack={onBack}/>);
        break;
      case "step3":
        pageName.current = "step2"
        setCurrentPage(<Step2 onNext={onNext} onBack={onBack}/>);
        break;
      default:
        break;
    }
  }
  function onNext(){
    switch (pageName.current){
      case "step1":
        pageName.current = "step2"
        setCurrentPage(<Step2 onNext={onNext} onBack={onBack}/>);
        break;
      case "step2":
        pageName.current = "step3"
        setCurrentPage(<Step3 onNext={onNext} onBack={onBack}/>);
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
    setCurrentPage(<Step1 onNext={onNext} onBack={onBack}/>);
  }

  function closeModal() {
    props.setIsOpen(false);
  }

  useEffect(()=>{
    pageName.current = "step1"
    setCurrentPage(<Step1 onNext={onNext} onBack={onBack}/>);
  },[])

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
