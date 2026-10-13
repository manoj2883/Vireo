import { useNavigate } from 'react-router-dom';
import { StoryBank } from '@/components/StoryBank';

/** Story Bank (`/stories`). Shows the existing Story Bank until Phase 5 rebuilds it. */
export function StoriesPage() {
  const navigate = useNavigate();
  return <StoryBank onStartInterviewerSession={() => navigate('/session')} />;
}
