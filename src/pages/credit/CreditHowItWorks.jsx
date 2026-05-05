import React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Zap, ShieldCheck, CheckCircle } from 'lucide-react';

const CreditHowItWorks = ({ onBack }) => {
  const fonts = {
    display: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
  };

  return (
    <div className="min-h-screen bg-[#0d0d12] text-white overflow-y-auto pb-24">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[40%] bg-violet-600/20 blur-[100px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[50%] bg-indigo-500/10 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <div className="relative z-10 px-6 pt-12 pb-6 sticky top-0 bg-[#0d0d12]/80 backdrop-blur-xl border-b border-white/5">
        <button 
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 border border-white/10 text-white backdrop-blur-md transition-all active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative z-10 px-6 pt-8 max-w-md mx-auto"
      >
        <motion.div variants={itemVariants} className="mb-10">
          <h1 className="text-[36px] font-light tracking-tight leading-[1.1] mb-4" style={{ fontFamily: fonts.display }}>
            How <span className="font-semibold text-violet-400">Credit</span> Works
          </h1>
          <p className="text-slate-400 text-[15px] leading-relaxed">
            We offer two distinct credit solutions tailored to your financial profile and assets. Choose what works best for you.
          </p>
        </motion.div>

        {/* Portfolio Backed Credit */}
        <motion.div variants={itemVariants} className="mb-8 bg-white/5 border border-white/10 rounded-[28px] p-6 backdrop-blur-md">
          <div className="flex items-center gap-4 mb-4">
            <div className="h-12 w-12 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Portfolio Backed</h2>
              <span className="text-xs font-medium text-violet-400 uppercase tracking-wider">Secured</span>
            </div>
          </div>
          <p className="text-sm text-slate-300 mb-6 leading-relaxed">
            Borrow against your existing investment portfolio without needing to sell your assets. This preserves your market position while giving you immediate access to liquidity.
          </p>
          <ul className="space-y-3">
            {["Lower interest rates", "No credit check required", "Keep earning dividends", "Flexible repayment terms"].map((feature, i) => (
              <li key={i} className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-violet-400 shrink-0" />
                <span className="text-sm text-slate-300">{feature}</span>
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Unsecured Credit */}
        <motion.div variants={itemVariants} className="bg-white/5 border border-white/10 rounded-[28px] p-6 backdrop-blur-md">
          <div className="flex items-center gap-4 mb-4">
            <div className="h-12 w-12 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Zap className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Unsecured Credit</h2>
              <span className="text-xs font-medium text-indigo-400 uppercase tracking-wider">Profile Based</span>
            </div>
          </div>
          <p className="text-sm text-slate-300 mb-6 leading-relaxed">
            Access capital instantly based on your digital profile and earning history. Designed for immediate capital needs with a streamlined application process.
          </p>
          <ul className="space-y-3">
            {["Instant approval process", "No collateral required", "Builds your platform score", "Transparent fee structure"].map((feature, i) => (
              <li key={i} className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-indigo-400 shrink-0" />
                <span className="text-sm text-slate-300">{feature}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default CreditHowItWorks;
