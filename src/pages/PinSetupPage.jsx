import React, { useState, useCallback } from 'react';
import { ArrowLeft, Delete } from 'lucide-react';
import { setPin, setPinEmail } from '../lib/usePin';
import { supabase } from '../lib/supabase';

const PIN_LENGTH = 5;

const PinDots = ({ filled, shake }) => (
  <div className={`flex items-center justify-center gap-4 ${shake ? 'animate-shake' : ''}`}>
    {Array.from({ length: PIN_LENGTH }).map((_, i) => (
      <div
        key={i}
        className={`h-4 w-4 rounded-full border-2 transition-all duration-200 ${
          i < filled
            ? 'border-slate-900 bg-slate-900 scale-110'
            : 'border-slate-200 bg-transparent'
        }`}
      />
    ))}
  </div>
);

const NumberPad = ({ onPress, onDelete }) => {
  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', 'delete'],
  ];

  return (
    <div className="mx-auto grid w-full max-w-xs grid-cols-3 gap-4">
      {keys.flat().map((key, i) => {
        if (key === '') return <div key={i} />;
        if (key === 'delete') {
          return (
            <button
              key={i}
              type="button"
              onClick={onDelete}
              className="flex h-16 w-16 items-center justify-center rounded-full text-slate-700 transition active:scale-90 active:bg-slate-100 mx-auto"
            >
              <Delete className="h-6 w-6" />
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPress(key)}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-2xl font-semibold text-slate-900 shadow-sm transition active:scale-90 active:bg-slate-50 mx-auto"
          >
            {key}
          </button>
        );
      })}
    </div>
  );
};

const PinSetupPage = ({ onNavigate, onBack }) => {
  const [step, setStep] = useState('enter');
  const [pin, setPin_] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [shake, setShake] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: '' });

  const showToast = (message, type = 'error') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: '' }), 3000);
  };

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const handlePress = useCallback(
    (digit) => {
      if (step === 'enter') {
        if (pin.length < PIN_LENGTH) {
          const newPin = pin + digit;
          setPin_(newPin);
          if (newPin.length === PIN_LENGTH) {
            setTimeout(() => setStep('confirm'), 300);
          }
        }
      } else {
        if (confirmPin.length < PIN_LENGTH) {
          const newConfirm = confirmPin + digit;
          setConfirmPin(newConfirm);
          if (newConfirm.length === PIN_LENGTH) {
            if (newConfirm === pin) {
              handleSave(newConfirm);
            } else {
              triggerShake();
              showToast('PINs do not match. Try again.');
              setTimeout(() => {
                setConfirmPin('');
                setStep('enter');
                setPin_('');
              }, 600);
            }
          }
        }
      }
    },
    [pin, confirmPin, step]
  );

  const handleDelete = useCallback(() => {
    if (step === 'enter') {
      setPin_((prev) => prev.slice(0, -1));
    } else {
      setConfirmPin((prev) => prev.slice(0, -1));
    }
  }, [step]);

  const handleSave = async (finalPin) => {
    try {
      await setPin(finalPin);
      if (supabase) {
        const { data } = await supabase.auth.getUser();
        if (data?.user?.email) {
          setPinEmail(data.user.email);
        }
      }
      showToast('PIN set successfully', 'success');
      setTimeout(() => {
        onBack ? onBack() : onNavigate?.('settings');
      }, 1000);
    } catch (err) {
      console.error('Failed to set PIN:', err);
      showToast('Failed to set PIN');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {toast.show && (
        <div
          className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 transform rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}

      <header className="flex items-center justify-between px-6 pt-12 pb-4">
        <button
          type="button"
          onClick={() => (onBack ? onBack() : onNavigate?.('settings'))}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition active:scale-95"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-3">
          <img src="/assets/mint-logo.svg" alt="Mint" className="h-6 w-auto" />
          <span className="mint-brand text-lg font-semibold tracking-[0.12em]">MINT</span>
        </div>
        <div className="w-10" />
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">
          {step === 'enter' ? 'Set PIN' : 'Confirm PIN'}
        </h1>
        <p className="mb-8 text-center text-sm text-slate-500">
          {step === 'enter'
            ? 'Enter a 5-digit PIN to secure your app'
            : 'Re-enter your PIN to confirm'}
        </p>

        <PinDots filled={step === 'enter' ? pin.length : confirmPin.length} shake={shake} />

        <div className="mt-12 w-full">
          <NumberPad onPress={handlePress} onDelete={handleDelete} />
        </div>
      </div>
    </div>
  );
};

export default PinSetupPage;
