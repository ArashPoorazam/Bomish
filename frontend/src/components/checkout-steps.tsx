import { Check } from "lucide-react";

// Palm-facing sketches with a folded thumb and separated raised fingers.
function StepHand({ count }: { count: number }) {
  const outlines = [
    "M21 43V13c0-6 9-6 9 0v24c1-6 9-6 9 0v2c1-6 9-6 9 0v3c1-5 9-5 9 1v7c0 7-4 11-7 15l-1 4H27l-1-5c-6-5-9-13-5-21Z",
    "M21 43 12 16c-2-6 6-9 9-3l10 22 9-26c2-6 10-3 8 3l-7 25c1-5 9-5 9 1v4c2-5 9-4 9 2v6c0 7-5 11-9 15l-1 4H27l-1-5c-6-5-9-13-5-21Z",
    "M21 43 10 22c-3-6 5-10 8-4l11 18-2-25c-1-7 9-8 10-1l1 24 8-20c2-6 10-3 8 3l-7 23c4-6 12-4 12 2v8c0 7-5 11-9 15l-1 4H27l-1-5c-6-5-9-13-5-21Z",
  ];
  return (
    <svg viewBox="0 0 72 76" fill="none" aria-hidden="true">
      <g
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={outlines[count - 1]} />
        {/* The thumb folds across the palm instead of pointing outward. */}
        <path d="M21 43c1-4 5-5 8-2l12 9c4 4-1 9-5 6l-9-6M28 73h20" />
        {count === 1 && <path d="M30 37v8c0 4 8 4 9 0v-6" />}
        {count < 3 && <path d="M40 40v6c0 4 8 4 8 0v-4" />}
        <path d="M49 44v4c0 4 7 4 8 0" />
      </g>
    </svg>
  );
}

export function CheckoutSteps({ payment }: { payment: boolean }) {
  const current = payment ? 2 : 1;
  return (
    <ol className="checkout-progress" aria-label="مراحل تکمیل خرید">
      {[
        ["ورود به حساب", "حساب شما آماده است"],
        ["نشانی و ارسال", "مقصد و هزینه ارسال"],
        ["پرداخت", "تأیید نهایی سفارش"],
      ].map(([title, description], index) => (
        <li
          key={title}
          aria-current={index === current ? "step" : undefined}
          data-complete={index < current}
        >
          <span className="checkout-hand">
            <StepHand count={index + 1} />
          </span>
          <div>
            <strong>
              <span>{["۱", "۲", "۳"][index]}.</span> {title}
            </strong>
            <small>{description}</small>
          </div>
          {index < current && (
            <Check
              className="checkout-step-check"
              size={16}
              aria-label="تکمیل‌شده"
            />
          )}
        </li>
      ))}
    </ol>
  );
}
