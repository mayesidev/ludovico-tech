type RatingSliderProps = {
  disabled?: boolean;
  id: string;
  onChange: (score: number) => void;
  value: number;
};

export function RatingSlider({
  disabled = false,
  id,
  onChange,
  value,
}: RatingSliderProps) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <label
          className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500"
          htmlFor={id}
        >
          Final rating
        </label>
        <span
          aria-label="Selected rating"
          className="min-w-12 rounded-full border border-marquee-gold/25 bg-curtain/20 px-3 py-1 text-center font-semibold text-marquee-light"
        >
          {value}
        </span>
      </div>
      <input
        aria-valuetext={`${value}`}
        className="mt-4 h-8 w-full cursor-pointer accent-marquee-gold disabled:cursor-not-allowed"
        disabled={disabled}
        id={id}
        max="5"
        min="0"
        onChange={(event) => onChange(Number(event.target.value))}
        step="0.5"
        type="range"
        value={value}
      />
      <div
        aria-hidden="true"
        className="flex justify-between text-xs font-semibold text-zinc-500"
      >
        <span>0</span>
        <span>1</span>
        <span>2</span>
        <span>3</span>
        <span>4</span>
        <span>5</span>
      </div>
    </div>
  );
}
