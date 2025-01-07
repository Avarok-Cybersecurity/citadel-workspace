import React from "react";
import ReactDOM from "react-dom/client";

import Home from "./pages/home/home";
import "./main.css";

import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Landing from "./pages/landing/landing";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Landing />,
  },
  {
    path: "/home",
    element: <Home />,
  },
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <RouterProvider router={router} />,
);
