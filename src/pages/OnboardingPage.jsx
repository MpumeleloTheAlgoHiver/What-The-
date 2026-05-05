import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import OriginButton from "../components/OriginButton";
import { supabase } from "../lib/supabase";

const OnboardingPage = ({ onCreateAccount, onLogin }) => {
  const [images, setImages] = useState(["/assets/images/onboarding-hero.png"]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    async function fetchImages() {
      try {
        const { data, error } = await supabase.storage.from("MintAuthImages").list();
        if (error) throw error;
        
        let validFiles = [];
        if (data && data.length > 0) {
          validFiles = data.filter(file => !file.name.startsWith('.'));
        } else {
          // Fallback to known files if RLS blocks list()
          validFiles = [
            { name: 'arnold-obizzy-eu2_RkoI1ys-unsplash.jpg' },
            { name: 'black-baby-spending-time-with-her-dad.jpg' },
            { name: 'blurred-man-wearing-virtual-reality-headset.jpg' },
            { name: 'business-woman-talking-her-smartphone.jpg' },
            { name: 'different-colour-friends-outdoor.jpg' }
          ];
        }
        if (validFiles.length > 0) {
          const urls = validFiles.map(file => {
            const { data: publicUrlData } = supabase.storage.from("MintAuthImages").getPublicUrl(file.name);
            return publicUrlData.publicUrl;
          });
          setImages(urls);
        }
      } catch (err) {
        console.error("Failed to fetch auth images:", err);
      }
    }
    fetchImages();
  }, []);

  useEffect(() => {
    if (images.length <= 1) return;
    
    // Change image every 5 hours
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }, 18000000);
    
    return () => clearInterval(interval);
  }, [images.length]);

  return (
    <div className="h-screen overflow-hidden bg-white">
      <div className="grid h-full grid-rows-2 lg:grid-cols-[1.05fr_1fr] lg:grid-rows-none">
        <div className="order-2 flex h-full flex-col px-6 py-8 lg:order-1 lg:px-16 lg:py-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 animate-on-load delay-1">
              <img src="/assets/mint-logo.svg" alt="Mint logo" className="h-6 w-auto" />
              <span className="mint-brand text-lg font-semibold tracking-[0.12em]">MINT</span>
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center space-y-8">
            <div className="space-y-3 animate-on-load delay-2">
              <h1 className="text-4xl font-semibold text-slate-900 sm:text-5xl">
                Welcome to <span className="mint-brand">Mint</span>
              </h1>
              <p className="text-lg text-slate-600">
                Your money tools are ready when you are.
              </p>
            </div>

            <div className="flex flex-col gap-4 animate-on-load delay-3 sm:items-start">
              <OriginButton
                onClick={onLogin}
                circleColor="rgba(148,163,184,0.18)"
                className="inline-flex w-full items-center justify-center rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-900 shadow-sm sm:w-auto"
              >
                Login
              </OriginButton>

              <OriginButton
                onClick={onCreateAccount}
                circleColor="rgba(255,255,255,0.12)"
                className="inline-flex w-full items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-slate-900/20 sm:w-auto"
              >
                Create Account
              </OriginButton>
            </div>
          </div>
        </div>

        <div className="order-1 h-full lg:order-2 bg-slate-100">
          <div className="relative h-full w-full overflow-hidden rounded-b-[3.5rem] [clip-path:ellipse(140%_90%_at_50%_0%)] lg:rounded-none lg:[clip-path:none]">
            <AnimatePresence mode="popLayout">
              <motion.img
                key={currentIndex}
                src={images[currentIndex]}
                alt="Auth visual"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.5, ease: "easeInOut" }}
                className="absolute inset-0 h-full w-full object-cover cursor-pointer"
                onClick={() => {
                  if (images.length > 1) {
                    setCurrentIndex((prev) => (prev + 1) % images.length);
                  }
                }}
              />
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingPage;
