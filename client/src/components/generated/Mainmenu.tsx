export function Mainmenu() {
  return (
    <section className="flex flex-col items-center bg-background rounded-lg" data-testid="screen-main-menu">
      <p className="text-primary text-3xl font-bold font-sans" data-testid="main-menu-logo">♟ Complete Chess 88</p>
      <p className="text-muted-foreground text-lg font-normal font-sans" data-testid="main-menu-subtitle">Play • Practice • Improve</p>
      <section className="flex flex-row items-center bg-primary rounded-lg" data-testid="btn-new-game">
        <Square className="bg-primary-foreground" data-testid="btn-new-game-icon" />
        <p className="text-primary-foreground text-lg font-semibold font-sans" data-testid="btn-new-game-label">New Game</p>
      </section>
      <section className="flex flex-row items-center bg-secondary rounded-lg" data-testid="btn-resume-game">
        <Square className="bg-secondary-foreground" data-testid="btn-resume-game-icon" />
        <p className="text-secondary-foreground text-lg font-semibold font-sans" data-testid="btn-resume-game-label">Resume Saved Game</p>
      </section>
      <section className="flex flex-row items-center bg-accent rounded-lg" data-testid="btn-statistics">
        <Square className="bg-accent-foreground" data-testid="btn-statistics-icon" />
        <p className="text-accent-foreground text-lg font-semibold font-sans" data-testid="btn-statistics-label">Statistics</p>
      </section>
      <div className="border border-border" data-testid="main-menu-divider" />
      <p className="text-muted-foreground text-sm font-normal font-sans" data-testid="main-menu-footer">Standard 8×8 Board • All Rules • Offline Ready</p>
    </section>
  );
}
