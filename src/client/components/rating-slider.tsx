import { Slider, SliderLabel } from "./ui/slider";

type RatingSliderProps = {
  disabled?: boolean;
  onChange: (score: number) => void;
  value: number;
};

export function RatingSlider({
  disabled = false,
  onChange,
  value,
}: RatingSliderProps) {
  return (
    <div>
      <Slider
        disabled={disabled}
        max={5}
        min={0}
        onValueChange={onChange}
        step={0.5}
        value={value}
      >
        <div className="flex items-center justify-between gap-4">
          <SliderLabel>Rating</SliderLabel>
          <span
            aria-label="Selected rating"
            className="min-w-10 text-right text-sm font-bold text-highlight-soft"
          >
            {value}
          </span>
        </div>
      </Slider>
      <div
        aria-hidden="true"
        className="flex justify-between text-xs font-medium text-text-muted"
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
