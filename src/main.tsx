import React from "react";
import ReactDOM from "react-dom/client";

import Home from "./elements/pages/home/home"
import "./main.css"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    
    <Home />
  </React.StrictMode>,
);
