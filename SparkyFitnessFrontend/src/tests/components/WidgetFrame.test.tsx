import { render } from '@testing-library/react';
import WidgetFrame from '@/components/widgets/WidgetFrame';
import { pxToRows } from '@/utils/dashboardLayout';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);

afterEach(() => jest.restoreAllMocks());

it('reserves the complete natural frame at a grid-row boundary and remeasures resized content', () => {
  let height = 291;
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => ({
      height,
      width: 668,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 668,
      bottom: height,
      toJSON: () => ({}),
    }));
  jest.spyOn(window, 'getComputedStyle').mockReturnValue({
    borderTopWidth: '1px',
    borderBottomWidth: '1px',
  } as CSSStyleDeclaration);
  let resize: ResizeObserverCallback = () => {};
  const observer = {
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  };
  jest.spyOn(window, 'ResizeObserver').mockImplementation((callback) => {
    resize = callback;
    return observer;
  });
  const measure = jest.fn();
  const { unmount } = render(
    <WidgetFrame
      widgetKey="energy"
      title="Energy"
      editMode={false}
      isMax={false}
      onToggleMax={jest.fn()}
      onHide={jest.fn()}
      onMeasure={measure}
    >
      <div>Energy content</div>
    </WidgetFrame>
  );
  expect(measure).toHaveBeenLastCalledWith('energy', 293);
  expect(pxToRows(measure.mock.lastCall![1])).toBe(8);
  height = 335;
  resize([], observer);
  expect(measure).toHaveBeenLastCalledWith('energy', 337);
  expect(pxToRows(measure.mock.lastCall![1])).toBe(9);
  unmount();
  expect(observer.disconnect).toHaveBeenCalled();
});
