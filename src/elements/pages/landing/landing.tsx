/*

Landing page for users who are first logging in

*/

import { useState } from "react";
import RegistrationPopup from "../../popups/registration/registration";
import "./landing.css";

export default function Landing() {
  const [registrationPopupOpen, setRegistrationPopupOpen] = useState(false);

  return (
    <div id="landing">
      <h1>Registration</h1>
      <p>
        This page is a placeholder for a more sophisticated registration page
      </p>

      <button
        onClick={() => {
          setRegistrationPopupOpen(true);
        }}
      >
        Add Workspace
      </button>

      <RegistrationPopup
        isOpen={registrationPopupOpen}
        setIsOpen={setRegistrationPopupOpen}
      />
    </div>
  );
}
