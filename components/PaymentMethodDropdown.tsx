"use client";

interface PaymentMethodDropdownProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const ALL_PAYMENT_METHODS = "__all__";

export default function PaymentMethodDropdown({ value, onChange, className }: PaymentMethodDropdownProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? "text-xs font-bold rounded-xl px-3 py-2 cursor-pointer outline-none"}
      style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
    >
      <option value={ALL_PAYMENT_METHODS}>All Payment Methods</option>
      <option value="Cash">Cash</option>
      <option value="Credit Card">Credit Card</option>
    </select>
  );
}
