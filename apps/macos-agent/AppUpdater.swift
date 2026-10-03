import Foundation

/// A newer agent release, as the agent announced it (agent kernel/updates).
struct AgentUpdate: Equatable {
    let current: String
    let latest: String
    let notesURL: URL
    let downloadURL: URL
    /// Downloaded and verified: "Restart to update" installs it. False: "Download" links out.
    let ready: Bool
}

/// Installs the disk image the agent downloaded and verified, because this app owns the bundle.
///
/// Atomic, and reversible until the new version proves itself: the new app is copied BESIDE this
/// one (same volume), verified there, the agent is stopped, the two bundles are swapped in one
/// call, and the new app is opened. If its agent does not answer on the loopback socket in time,
/// the new app is terminated, the bundles are swapped back, and this app's agent starts again.
/// Every step is in `UpdateSteps`, so the sequence is tested without touching a real install.
final class AppUpdater {
    struct Steps {
        /// The app inside the disk image at the URL, copied to the second URL.
        var extract: (_ image: URL, _ to: URL) throws -> Void
        /// Throws unless the app at the URL is ours, notarised, and is the version given.
        var verify: (_ app: URL, _ version: String) throws -> Void
        var stopAgent: (_ then: @escaping () -> Void) -> Void
        var restartAgent: () -> Void
        /// Exchanges two directories atomically.
        var swap: (_ a: URL, _ b: URL) throws -> Void
        /// Opens a new instance of the app; the result arrives on the main queue.
        var open: (_ app: URL, _ then: @escaping (Result<Launched, Error>) -> Void) -> Void
        /// Whether an agent answers on the loopback socket.
        var healthy: () -> Bool
        var remove: (_ item: URL) -> Void
        var after: (_ seconds: TimeInterval, _ then: @escaping () -> Void) -> Void
        var now: () -> Date
        var quit: () -> Void
        var log: (String) -> Void
        /// Runs slow work (mounting, verifying) off the main queue, then its result back on it.
        var background: (_ work: @escaping () -> Void, _ then: @escaping () -> Void) -> Void
    }

    struct Launched {
        let terminate: () -> Void
    }

    /// How long the new version's agent has to answer.
    static let healthyWithin: TimeInterval = 60
    static let probeEvery: TimeInterval = 0.5

    private let bundle: URL
    private let steps: Steps
    private var installing = false
    /// Why an install did not happen, for the agent that is still running (UpdateInstallResult).
    var onFailure: ((_ version: String, _ why: String) -> Void)?

    init(bundle: URL, steps: Steps) {
        self.bundle = bundle
        self.steps = steps
    }

    /// Where the incoming app is staged: beside this one, so the swap never crosses a volume.
    var incoming: URL {
        bundle.deletingLastPathComponent().appendingPathComponent(".\(bundle.lastPathComponent).incoming")
    }

    func install(image: URL, version: String) {
        guard !installing else { steps.log("an update is already being installed; ignoring \(version)"); return }
        installing = true
        let staged = incoming
        var problem: Error?
        steps.background({ [steps] in
            do {
                steps.remove(staged)
                try steps.extract(image, staged)
                try steps.verify(staged, version)
            } catch {
                problem = error
            }
        }, { [self] in
            if let problem {
                steps.remove(staged)
                fail(version, "\(problem)", restart: false)
            } else {
                swapIn(staged, version)
            }
        })
    }

    private func swapIn(_ staged: URL, _ version: String) {
        steps.log("installing \(version)")
        steps.stopAgent { [self] in
            do {
                try steps.swap(staged, bundle)
            } catch {
                steps.remove(staged)
                fail(version, "the new version could not be put in place: \(error)", restart: true)
                return
            }
            // `staged` now holds the previous version, until the new one has answered.
            steps.open(bundle) { [self] result in
                switch result {
                case .failure(let error):
                    rollBack(version, "the new version did not open: \(error)", launched: nil)
                case .success(let launched):
                    waitHealthy(version, launched: launched, deadline: steps.now().addingTimeInterval(Self.healthyWithin))
                }
            }
        }
    }

    private func waitHealthy(_ version: String, launched: Launched, deadline: Date) {
        if steps.healthy() {
            steps.log("\(version) answers; the previous version is removed")
            steps.remove(incoming)
            steps.quit()
            return
        }
        guard steps.now() < deadline else {
            rollBack(version, "the new version's agent did not answer within \(Int(Self.healthyWithin))s", launched: launched)
            return
        }
        steps.after(Self.probeEvery) { [self] in waitHealthy(version, launched: launched, deadline: deadline) }
    }

    private func rollBack(_ version: String, _ why: String, launched: Launched?) {
        launched?.terminate()
        do {
            try steps.swap(incoming, bundle)
            steps.remove(incoming)
        } catch {
            steps.log("the previous version could not be put back: \(error)")
        }
        fail(version, why, restart: true)
    }

    private func fail(_ version: String, _ why: String, restart: Bool) {
        steps.log("update to \(version) not installed: \(why)")
        installing = false
        if restart { steps.restartAgent() }
        onFailure?(version, why)
    }
}
