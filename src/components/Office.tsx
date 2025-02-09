
import { useLocation } from "react-router-dom";
import { AppLayout } from "./layout/AppLayout";
import { CompanyOffice } from "./office/CompanyOffice";
import { MarketingOffice } from "./office/MarketingOffice";
import { HROffice } from "./office/HROffice";
import { FileManagerContent } from "./file-manager/FileManagerContent";

export const Office = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const section = params.get("section") || "company";

  return (
    <AppLayout>
      {section === "company" && <CompanyOffice />}
      {section === "marketing" && <MarketingOffice />}
      {section === "hr" && <HROffice />}
      {section === "files" && <FileManagerContent />}
    </AppLayout>
  );
};

