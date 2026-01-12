const SR_SHORT_RETRY_MINUTES = 10;

function clamp(num, min, max){
  return Math.min(max, Math.max(min, num));
}

function applySpacedRepetition({sr, grade, now = Date.now()}){
  const next = {
    intervalDays: sr?.intervalDays ?? 0,
    ease: sr?.ease ?? 2.5,
    reps: sr?.reps ?? 0,
    lapses: sr?.lapses ?? 0,
    dueAt: sr?.dueAt ?? now,
    lastGrade: sr?.lastGrade ?? null
  };

  if(grade === "again"){
    next.reps = 0;
    next.lapses = (next.lapses || 0) + 1;
    next.intervalDays = 0;
    next.dueAt = now + SR_SHORT_RETRY_MINUTES * 60 * 1000;
    next.ease = clamp((next.ease || 2.5) - 0.2, 1.3, 3.5);
  }else{
    next.reps = (next.reps || 0) + 1;
    const delta = grade === "hard" ? -0.15 : (grade === "easy" ? 0.15 : 0);
    next.ease = clamp((next.ease || 2.5) + delta, 1.3, 3.5);
    if(next.reps === 1){
      next.intervalDays = 1;
    }else if(next.reps === 2){
      next.intervalDays = 3;
    }else{
      const mult = grade === "hard" ? 1.2 : (grade === "easy" ? (next.ease + 0.3) : next.ease);
      next.intervalDays = Math.max(1, Math.round(next.intervalDays * mult));
    }
    next.dueAt = now + next.intervalDays * 24 * 60 * 60 * 1000;
  }
  next.lastGrade = grade;
  return next;
}

export {applySpacedRepetition};
