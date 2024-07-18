import React, { useEffect, useState } from "react";
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

export default function RegistrationPopup(props: {
  isOpen: boolean;
  setIsOpen: (state: boolean) => void;
}) {
  const [currentPage, setCurrentPage] = useState<JSX.Element>(<></>);

  function openModal() {
    setCurrentPage(step1);
    props.setIsOpen(true);
  }

  function afterOpenModal() {
    setCurrentPage(step1);
    // references are now sync'd and can be accessed.
  }

  function closeModal() {
    props.setIsOpen(false);
  }

  // Step 1: Get identifier and password
  const step1 = (
    <>
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
        <button id="cancel-btn" onClick={closeModal}>
          Cancel
        </button>
        <button
          id="next-btn"
          onClick={() => {
            setCurrentPage(step2);
          }}
        >
          Next
        </button>
      </div>
    </>
  );

  // Configure session security settings
  const [advancedMode, setAdvancedMode] = useState(false);
  const step2 = (
    <>
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
      <h2>Advanced Settings {advancedMode ? "hi" : "bye"}</h2>
      <button onClick={()=>{setAdvancedMode(!advancedMode)}}><i className="bi bi-chevron-down"></i></button>
    </div>

    <div className="advanced-settings" style={{display: (advancedMode) ? "block" : "none"}}>
        <h3>Encryption Algorithm</h3>
        <div className="input-icon-pair">
        <Select
            className="select"
            options={secrecyOptions}
            defaultValue={secrecyOptions[0]}
            unstyled
        />
        <i className="bi bi-question-circle"></i>
        </div>

        <h3>KEM Algorithm</h3>
        <div className="input-icon-pair">
        <Select
            className="select"
            options={secrecyOptions}
            defaultValue={secrecyOptions[0]}
            unstyled
        />
        <i className="bi bi-question-circle"></i>
        </div>

        <h3>SIG Algorithm</h3>
        <div className="input-icon-pair">
        <Select
            className="select"
            options={secrecyOptions}
            defaultValue={secrecyOptions[0]}
            unstyled
        />
        <i className="bi bi-question-circle"></i>
        </div>


    </div>

      <div className="bottom-buttons">
        <button
          id="cancel-btn"
          onClick={() => {
            setCurrentPage(step1);
          }}
        >
          Back
        </button>
        <button
          id="next-btn"
          onClick={() => {
            setCurrentPage(step2);
          }}
        >
          Next
        </button>
      </div>
    </>
  );


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
