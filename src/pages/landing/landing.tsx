/*

Landing page for users who are first logging in

*/

import React from "react";
import { useState } from "react";
import "./landing.css";
import RegistrationPopup from "../../components/registration/registration";

export default function Landing() {
  const [registrationPopupOpen, setRegistrationPopupOpen] = useState(false);

  return (
    <div id="landing">
      <h1 className="text-3xl font-bold underline text-cyan-900">
        Hello world!
      </h1>
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
