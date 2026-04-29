const AuthLayout = ({ children }) => (
  <div className="relative flex min-h-screen flex-col bg-white">
    {children}

    <div className="relative z-10 px-6 pb-12">
      <div className="text-center text-xs text-muted-foreground/80 max-w-5xl mx-auto leading-relaxed animate-on-load delay-5">
        <span className="mint-brand">MINT</span> (Pty) Ltd is a Financial Services Provider (FSP 55118) and a
        Registered Credit Provider (NCRCP22892). <span className="mint-brand">MINT</span> Reg no: 2024/644796/07
      </div>
    </div>
  </div>
);

export default AuthLayout;
