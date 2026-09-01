const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function localDate(year, month, day) {
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month, day);
  return date;
}

function toIsoDate(date) {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseIsoDate(value) {
  const normalized = normalizeDateValue(value);
  if (!normalized) return null;
  const [, year, month, day] = ISO_DATE_PATTERN.exec(normalized);
  return localDate(Number(year), Number(month) - 1, Number(day));
}

function sameLocalDate(first, second) {
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate();
}

export function normalizeDateValue(value) {
  const match = ISO_DATE_PATTERN.exec(String(value || '').trim());
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = localDate(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function isDateOnOrAfter(value, minimum = new Date()) {
  const date = parseIsoDate(value);
  if (!date) return false;
  const minimumDate = localDate(minimum.getFullYear(), minimum.getMonth(), minimum.getDate());
  return date >= minimumDate;
}

export function formatDateLabel(value) {
  const date = parseIsoDate(value);
  if (!date) return '选择目标日期';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function buildCalendarDays(year, month, today = new Date()) {
  const firstDay = localDate(year, month, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const start = localDate(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      value: toIsoDate(date),
      day: date.getDate(),
      inMonth: date.getFullYear() === year && date.getMonth() === month,
      isToday: sameLocalDate(date, today),
      isPast: !isDateOnOrAfter(toIsoDate(date), today),
    };
  });
}

function shiftMonth(date, amount) {
  const targetMonth = date.getMonth() + amount;
  const lastDay = localDate(date.getFullYear(), targetMonth + 1, 0).getDate();
  return localDate(date.getFullYear(), targetMonth, Math.min(date.getDate(), lastDay));
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export class GoalDatePicker {
  constructor(root) {
    this.root = root;
    this.input = root.querySelector('[data-date-value]');
    this.trigger = root.querySelector('[data-date-trigger]');
    this.valueLabel = root.querySelector('[data-date-label]');
    this.popover = root.querySelector('[data-date-popover]');
    this.monthLabel = root.querySelector('[data-date-month]');
    this.grid = root.querySelector('[data-date-grid]');
    this.isOpen = false;
    const initialDate = parseIsoDate(this.input.value) || new Date();
    this.viewDate = localDate(initialDate.getFullYear(), initialDate.getMonth(), 1);

    this.popover.remove();
    document.body.append(this.popover);
    this.bindEvents();
    this.setValue(this.input.value);
  }

  bindEvents() {
    this.trigger.addEventListener('click', () => this.toggle());

    this.popover.addEventListener('click', (event) => {
      const dayButton = event.target.closest('[data-date]');
      if (dayButton) {
        this.setValue(dayButton.dataset.date, { emit: true });
        this.close();
        return;
      }

      const action = event.target.closest('[data-date-action]')?.dataset.dateAction;
      if (action === 'previous' || action === 'next') {
        this.viewDate = shiftMonth(this.viewDate, action === 'previous' ? -1 : 1);
        this.viewDate.setDate(1);
        this.render();
      } else if (action === 'today') {
        this.setValue(toIsoDate(new Date()), { emit: true });
        this.close();
      } else if (action === 'clear') {
        this.setValue('', { emit: true });
        this.close();
      }
    });

    this.grid.addEventListener('keydown', (event) => this.handleGridKeydown(event));
    document.addEventListener('pointerdown', (event) => {
      if (!this.isOpen || this.root.contains(event.target) || this.popover.contains(event.target)) return;
      this.close({ restoreFocus: false });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.isOpen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
    }, true);

    const reposition = () => {
      if (this.isOpen) this.positionPopover();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('hashchange', () => this.close({ restoreFocus: false }));
    window.addEventListener('popstate', () => this.close({ restoreFocus: false }));
    this.input.form?.addEventListener('reset', () => {
      window.requestAnimationFrame(() => this.setValue(this.input.defaultValue));
    });
  }

  handleGridKeydown(event) {
    const currentButton = event.target.closest('[data-date]');
    if (!currentButton) return;
    const current = parseIsoDate(currentButton.dataset.date);
    let target = null;
    if (event.key === 'ArrowLeft') target = addDays(current, -1);
    if (event.key === 'ArrowRight') target = addDays(current, 1);
    if (event.key === 'ArrowUp') target = addDays(current, -7);
    if (event.key === 'ArrowDown') target = addDays(current, 7);
    if (event.key === 'Home') target = addDays(current, -((current.getDay() + 6) % 7));
    if (event.key === 'End') target = addDays(current, 6 - ((current.getDay() + 6) % 7));
    if (event.key === 'PageUp') target = shiftMonth(current, -1);
    if (event.key === 'PageDown') target = shiftMonth(current, 1);
    if (!target) return;
    const today = new Date();
    if (!isDateOnOrAfter(toIsoDate(target), today)) {
      target = localDate(today.getFullYear(), today.getMonth(), today.getDate());
    }
    event.preventDefault();
    this.viewDate = localDate(target.getFullYear(), target.getMonth(), 1);
    this.render({ focusDate: toIsoDate(target) });
  }

  setValue(value, { emit = false } = {}) {
    const normalized = normalizeDateValue(value);
    this.input.value = normalized;
    this.valueLabel.textContent = formatDateLabel(normalized);
    this.trigger.classList.toggle('has-value', Boolean(normalized));
    if (normalized) {
      const selected = parseIsoDate(normalized);
      this.viewDate = localDate(selected.getFullYear(), selected.getMonth(), 1);
    }
    if (this.isOpen) this.render();
    if (emit) {
      this.input.dispatchEvent(new Event('input', { bubbles: true }));
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.isOpen = true;
    this.popover.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.render();
    this.positionPopover();
    window.requestAnimationFrame(() => {
      const preferred = this.input.value || toIsoDate(new Date());
      const focusTarget = this.grid.querySelector(`[data-date="${preferred}"]`)
        || this.grid.querySelector('[data-current-month]');
      focusTarget?.focus({ preventScroll: true });
    });
  }

  close({ restoreFocus = true } = {}) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.popover.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.trigger.focus({ preventScroll: true });
  }

  positionPopover() {
    const gutter = 12;
    const triggerRect = this.trigger.getBoundingClientRect();
    const width = Math.min(350, window.innerWidth - (gutter * 2));
    this.popover.style.width = `${width}px`;
    this.popover.style.maxHeight = `${window.innerHeight - (gutter * 2)}px`;
    const popoverHeight = this.popover.getBoundingClientRect().height;
    const roomBelow = window.innerHeight - triggerRect.bottom - gutter;
    const preferredTop = roomBelow >= popoverHeight + 8
      ? triggerRect.bottom + 8
      : triggerRect.top - popoverHeight - 8;
    const left = Math.min(Math.max(gutter, triggerRect.left), window.innerWidth - width - gutter);
    const top = Math.min(Math.max(gutter, preferredTop), window.innerHeight - popoverHeight - gutter);
    this.popover.style.left = `${Math.round(left)}px`;
    this.popover.style.top = `${Math.round(top)}px`;
  }

  render({ focusDate = '' } = {}) {
    const selectedValue = normalizeDateValue(this.input.value);
    const days = buildCalendarDays(this.viewDate.getFullYear(), this.viewDate.getMonth());
    this.monthLabel.textContent = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
    }).format(this.viewDate);
    this.grid.replaceChildren();

    const preferredFocus = (days.some((day) => day.value === focusDate && !day.isPast) ? focusDate : '')
      || (days.some((day) => day.value === selectedValue && !day.isPast) ? selectedValue : '')
      || (days.find((day) => day.isToday)?.value || '')
      || days.find((day) => day.inMonth && !day.isPast)?.value;

    const previousButton = this.popover.querySelector('[data-date-action="previous"]');
    const currentMonth = localDate(new Date().getFullYear(), new Date().getMonth(), 1);
    previousButton.disabled = this.viewDate <= currentMonth;

    days.forEach((day) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.date = day.value;
      if (day.inMonth) button.dataset.currentMonth = '';
      button.textContent = String(day.day);
      button.className = 'goal-date-day';
      button.classList.toggle('is-outside', !day.inMonth);
      button.classList.toggle('is-selected', day.value === selectedValue);
      button.classList.toggle('is-today', day.isToday);
      button.disabled = day.isPast;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-selected', String(day.value === selectedValue));
      button.setAttribute('aria-label', `${formatDateLabel(day.value)}${day.isToday ? '，今天' : ''}${day.isPast ? '，已过去，不可选择' : ''}`);
      if (day.isToday) button.setAttribute('aria-current', 'date');
      button.tabIndex = day.value === preferredFocus ? 0 : -1;
      this.grid.append(button);
    });

    if (focusDate) this.grid.querySelector(`[data-date="${focusDate}"]`)?.focus({ preventScroll: true });
    this.positionPopover();
  }
}
