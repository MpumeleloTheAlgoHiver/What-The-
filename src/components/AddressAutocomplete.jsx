import React, { useState, useEffect, useRef } from "react";
import { MapPin, X } from "lucide-react";

const AddressAutocomplete = ({ value, onChange, placeholder = "Enter your address", inputClassName = "", containerClassName = "" }) => {
  const [query, setQuery] = useState(value || "");
  const wrapperRef = useRef(null);

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  const handleInputChange = (e) => {
    const inputValue = e.target.value;
    setQuery(inputValue);
    onChange(inputValue);
  };

  const handleClear = () => {
    setQuery("");
    onChange("");
  };

  const defaultInputClass = "w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-10 text-base font-medium text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-0";

  return (
    <div ref={wrapperRef} className={`relative ${containerClassName}`}>
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          placeholder={placeholder}
          className={inputClassName || defaultInputClass}
        />
        {query ? (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default AddressAutocomplete;
