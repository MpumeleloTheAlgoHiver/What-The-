import { TrendingUp, TrendingDown, Eye, EyeOff } from 'lucide-react';
import { useAccount } from '@/context/AccountContext';
import { useState } from 'react';
import Sparkline from '@/components/markets/Sparkline';

const PortfolioCard = () => {
  const { activeAccount, isChildAccount } = useAccount();
  const [period, setPeriod] = useState<'D' | 'W' | 'M' | 'Y' | 'All'>('M');
  const [hidden, setHidden] = useState(false);

  const formatCurrency = (val: number) =>
    `R${val.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace('.', ',')}`;

  const isPositive = activeAccount.portfolioChange >= 0;
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;
  const periods = ['D', 'W', 'M', 'Y', 'All'] as const;

  return (
    <div className="mx-4 rounded-3xl gradient-hero-card shadow-hero p-5 relative overflow-hidden border border-white/5">
      {/* Ambient glows */}
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-accent/30 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full bg-primary/15 blur-3xl pointer-events-none" />

      {/* Top row: label + visibility */}
      <div className="flex items-center justify-between relative">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-[0.18em] text-white/60">
            PORTFOLIO VALUE
          </span>
          <button
            onClick={() => setHidden(h => !h)}
            className="text-white/50 hover:text-white/90 transition-colors"
            aria-label="Toggle visibility"
          >
            {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          <span className="text-[9px] tracking-wider text-white/50 font-semibold">LIVE</span>
        </div>
      </div>

      {/* Value + change side by side */}
      <div className="flex items-end justify-between mt-2 relative">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white leading-none">
            {hidden ? '••••••' : formatCurrency(activeAccount.portfolioValue)}
          </h2>
          <div className="flex items-center gap-2 mt-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              isPositive ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'
            }`}>
              <TrendIcon size={11} strokeWidth={2.5} />
              {hidden ? '••••' : formatCurrency(Math.abs(activeAccount.portfolioChange))}
            </span>
            <span className={`text-[11px] font-medium ${isPositive ? 'text-success' : 'text-destructive'}`}>
              {isPositive ? '+' : '-'}{Math.abs(activeAccount.portfolioChangePercent)}%
            </span>
          </div>
        </div>

        {/* Inline sparkline */}
        <div className="opacity-90">
          <Sparkline
            data={activeAccount.chartData.length > 1 ? activeAccount.chartData : [1, 1]}
            width={110}
            height={48}
            filled
            strokeWidth={2}
            positive={isPositive}
          />
        </div>
      </div>

      {/* Period selector */}
      <div className="mt-4 flex bg-black/20 backdrop-blur-sm rounded-full p-0.5 relative">
        {periods.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
              period === p
                ? 'bg-white text-background shadow-sm'
                : 'text-white/60 hover:text-white/90'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Footer split */}
      <div className="mt-4 pt-4 border-t border-white/10 flex relative">
        <div className="flex-1">
          <div className="text-[9px] tracking-[0.15em] text-white/50 font-semibold">CASH</div>
          <div className="text-sm font-bold text-white mt-0.5">
            {hidden ? '••••' : formatCurrency(activeAccount.accountBalance)}
          </div>
        </div>
        <div className="w-px bg-white/10" />
        <div className="flex-1 pl-4">
          <div className="text-[9px] tracking-[0.15em] text-white/50 font-semibold">MINT NUMBER</div>
          <div className="text-sm font-bold text-white mt-0.5 font-mono">{activeAccount.mintNumber}</div>
        </div>
      </div>

      {/* Child badge */}
      {isChildAccount && (
        <div className="mt-3 bg-accent/15 border border-accent/30 rounded-xl px-3 py-2 flex items-center gap-2 relative">
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-[10px] text-white/80">
            Managed by parent · Age {activeAccount.age} · Independent at 18
          </span>
        </div>
      )}
    </div>
  );
};

export default PortfolioCard;
