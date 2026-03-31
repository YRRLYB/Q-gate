import { Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { QuizEntryPage } from "./pages/QuizEntryPage";
import { QuizSessionPage } from "./pages/QuizSessionPage";
import { ResultPage } from "./pages/ResultPage";
import { StudioPage } from "./pages/StudioPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/quiz/:slug" element={<QuizEntryPage />} />
      <Route
        path="/quiz/:slug/session/:attemptId"
        element={<QuizSessionPage />}
      />
      <Route path="/quiz/:slug/result/:attemptId" element={<ResultPage />} />
      <Route path="/admin" element={<StudioPage />} />
    </Routes>
  );
}
