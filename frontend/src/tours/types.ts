import type { Step } from 'react-joyride';

export interface TourStepDef extends Step {
  data?: {
    route?: string;
  };
}
