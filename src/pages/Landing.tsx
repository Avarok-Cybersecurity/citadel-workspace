import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { useState } from "react";
import { ServerConnect } from "@/components/ServerConnect";
import { SecuritySettings } from "@/components/SecuritySettings";
import { Join } from "@/components/Join";

export const Landing = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<'none' | 'server' | 'security' | 'join'>('none');

  const handleServerNext = () => setCurrentStep('security');
  const handleSecurityNext = () => setCurrentStep('join');
  const handleSecurityBack = () => setCurrentStep('server');
  const handleJoinNext = () => navigate('/office');
  const handleJoinBack = () => setCurrentStep('security');
  const startRegistration = () => setCurrentStep('server');

  return (
    <div className="min-h-screen flex items-center relative overflow-hidden bg-[#1C1D28]">
      {/* Background Image */}
      <div
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-70"
        style={{
          backgroundImage: "url('/lovable-uploads/fcd25400-92a0-41ed-95ae-573a0298bd55.png')",
          backgroundSize: 'cover',
          width: '100%',
          height: '100%',
          position: 'fixed'
        }}
      />

      {/* Gradient Overlay */}
      <div
        className="absolute inset-0 z-0 bg-gradient-to-r from-[#1C1D28] via-[rgba(28,29,40,0.8)] to-[rgba(28,29,40,0.4)]"
        style={{
          position: 'fixed'
        }}
      />
      
      {/* Content */}
      <div className="container mx-auto px-4 sm:px-6 relative z-10">
        <div className="max-w-3xl animate-fade-in">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
            The World's First Post-Quantum Virtual Workspace
          </h1>
          
          <p className="text-lg sm:text-xl text-gray-300 mb-8 sm:mb-12">
            Hyper-security and control over defense and privacy at your fingertips
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4">
            <Button
              onClick={startRegistration}
              className="bg-white text-black hover:bg-gray-100 text-lg px-8 h-[60px] transition-colors duration-300 w-full sm:w-auto"
              size="lg"
            >
              Join Workspace
            </Button>
            
            <Button
              variant="outline"
              className="border-white bg-white text-black hover:bg-gray-100 text-lg px-8 h-[60px] flex items-center gap-2 transition-colors duration-300 w-full sm:w-auto"
              size="lg"
            >
              <PlusCircle className="w-5 h-5" />
              Create Workspace
            </Button>
          </div>
        </div>
      </div>

      {/* Registration Flow Overlays */}
      {currentStep === 'server' && (
        <ServerConnect onNext={handleServerNext} />
      )}
      {currentStep === 'security' && (
        <SecuritySettings onNext={handleSecurityNext} onBack={handleSecurityBack} />
      )}
      {currentStep === 'join' && (
        <Join onNext={handleJoinNext} onBack={handleJoinBack} />
      )}
    </div>
  );
};

export default Landing;